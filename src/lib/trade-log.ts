import { useSyncExternalStore } from "react";

export type ExecStatus = "submitted" | "filled" | "failed" | "closed";

export interface LogEntry {
  id: string;
  ts: number;
  type: "info" | "trade" | "error" | "success" | "status";
  text: string;
  tradeId?: string;
  status?: ExecStatus;
  /** Live line updated in place (e.g. the scan countdown) instead of appending. */
  live?: string;
}

interface LogState {
  entries: LogEntry[];
  running: boolean;
  runningEAId: string | null;
  runVersion: number;
  /** Trades were placed this run: the bot stays on but scans nothing until STOP EA → START. */
  holding: boolean;
  panelOpen: boolean;
}

const listeners = new Set<() => void>();
let state: LogState = { entries: [], running: false, runningEAId: null, runVersion: 0, holding: false, panelOpen: false };
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const get = () => state;

export const useTradeLog = () => useSyncExternalStore(subscribe, get, get);

// Trade log never mentions the chart timeframes the scanner uses (product rule).
const TF_STRICT = /\b(?:M1|M5|M15|M30|H1|H4|1m|5m|15m|30m|1h|4h)\b/;
export function stripTimeframes(text: string): string {
  if (!TF_STRICT.test(text)) return text;
  return text
    .replace(/\b(?:M1|M5|M15|M30|H1|H4|1m|5m|15m|30m|1h|4h)(?:\s*(?:\/|,|and|\+)\s*(?:M1|M5|M15|M30|H1|H4|1m|5m|15m|30m|1h|4h))*\b\s*/g, "")
    .replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.:;·])/g, "$1").trim();
}

function push(entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) {
  const e: LogEntry = { id: crypto.randomUUID(), ts: entry.ts ?? Date.now(), ...entry, text: stripTimeframes(entry.text) };
  // Oldest first, newest appended at the bottom (terminal style).
  state = { ...state, entries: [...state.entries, e].slice(-300) };
  emit();
  return e.id;
}

export const SCANNING_TEXT = "Scanning market........";
export const executedText = (done: number, total: number) => `${Math.max(0, done)}/${Math.max(1, total)} trades executed`;

/** First sentence of a scanner reason, trimmed so the log stays readable. */
export function shortReason(reason?: string): string {
  const r = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (!r) return "";
  const first = r.split(/(?<=[.!?])\s|\s·\s|;\s/)[0].replace(/[.\s]+$/, "");
  return first.length > 110 ? `${first.slice(0, 107).trimEnd()}…` : first;
}

/* ---------------- Structured trade journal (part of the same Trade Log) ---------------- */

export type JournalMode = "analysis" | "paper" | "live" | "classic";
export type JournalOutcome = "signal" | "open" | "win" | "loss" | "breakeven" | "rejected" | "expired" | "cancelled";

/** One signal or trade with the full details; stored on this device and shown in the dashboard history. */
export interface JournalRecord {
  id: string;
  ts: number;
  kind: "signal" | "trade";
  mode: JournalMode;
  strategy: string;
  symbol: string;
  side: string;
  stage?: "early" | "confirmed";
  entry?: number;
  exit?: number;
  stopLoss?: number | string;
  takeProfit?: number | string;
  lots?: number;
  outcome: JournalOutcome;
  pnl?: number;
  rMultiple?: number;
  closedAt?: number;
  market?: string;
  confidence?: number;
  reasonEntry?: string;
  reasonExit?: string;
}

const JOURNAL_KEY = "algo:trade-journal";
const JOURNAL_LIMIT = 500;
const EMPTY_JOURNAL: JournalRecord[] = [];
let journal: JournalRecord[] | null = null;
const journalListeners = new Set<() => void>();
const loadJournal = (): JournalRecord[] => {
  if (journal) return journal;
  try { journal = typeof localStorage === "undefined" ? [] : (JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "[]") as JournalRecord[]); }
  catch { journal = []; }
  if (!Array.isArray(journal)) journal = [];
  return journal;
};
function saveJournal(next: JournalRecord[]) {
  journal = next.slice(-JOURNAL_LIMIT);
  try { if (typeof localStorage !== "undefined") localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal)); } catch { /* storage full or unavailable */ }
  journalListeners.forEach((l) => l());
}
const subscribeJournal = (l: () => void) => { journalListeners.add(l); return () => journalListeners.delete(l); };
export const useTradeJournal = () => useSyncExternalStore(subscribeJournal, loadJournal, () => EMPTY_JOURNAL);

export interface TradeSubmit {
  side: string; symbol: string;
  lot: string | number; entry: string | number;
  sl: string | number; tp: string | number;
}

export const tradeLog = {
  // NOTE: start/stop only flip the running state; the welcome lines come from engineOn().
  start(eaId: string) {
    state = { ...state, running: true, runningEAId: eaId, runVersion: state.runVersion + 1, holding: false };
    emit();
  },
  stop() {
    // Drop the live "Scanning market" line so a stopped bot never looks like it is scanning.
    state = { ...state, entries: state.entries.filter((e) => !e.live), running: false, runningEAId: null, runVersion: state.runVersion + 1, holding: false };
    emit();
  },
  version() { return state.runVersion; },
  entries() { return state.entries; },
  canExecute(eaId: string, version: number) { return state.running && !state.holding && state.runningEAId === eaId && state.runVersion === version; },
  /** After trades are placed the bot stays switched on but stops scanning until the user presses STOP EA and START again. */
  holdAfterTrade() {
    if (!state.running || state.holding) return;
    state = { ...state, holding: true, entries: state.entries.filter((e) => !e.live) };
    push({ type: "info", text: "Trades placed — press STOP EA, then START to scan again" });
  },
  /** Welcome lines shown when the user switches the bot on. */
  engineOn() {
    state = { ...state, entries: [] };
    push({ type: "success", text: "Money engine on" });
    push({ type: "info", text: "Welcome to the future of automation" });
    tradeLog.scanning();
  },
  /** One live line while the bot looks for a setup. */
  scanning() { tradeLog.live("scan-countdown", SCANNING_TEXT); },
  /** Logs a received signal and returns a tradeId for the execution result. */
  signal(t: { symbol: string; side: string; sl: string | number; tp: string | number; entry?: number; confidence?: number; strategy?: string; reason?: string; market?: string; mode?: JournalMode }): string {
    const tradeId = crypto.randomUUID();
    tradeLog.record({ id: tradeId, kind: "trade", mode: t.mode ?? "classic", strategy: t.strategy ?? "AlgoVault signal", symbol: t.symbol, side: String(t.side).toUpperCase(),
      entry: t.entry, stopLoss: t.sl, takeProfit: t.tp, confidence: t.confidence, reasonEntry: t.reason, market: t.market, outcome: "signal" }, false);
    state = { ...state, entries: state.entries.filter((e) => !e.live) };
    push({ type: "trade", tradeId, text: "New signal received" });
    push({ type: "trade", tradeId, text: `Symbol: ${t.symbol}` });
    push({ type: "trade", tradeId, text: `Direction: ${String(t.side).toUpperCase() === "SELL" ? "Sell" : "Buy"}` });
    push({ type: "trade", tradeId, text: `TP: ${t.tp}` });
    push({ type: "trade", tradeId, text: `SL: ${t.sl}` });
    return tradeId;
  },
  /** Logs a WAIT reading from the scanner: no trade is placed. */
  wait(t: { symbol: string; reason?: string }) {
    const reason = shortReason(t.reason);
    push({ type: "info", text: "Wait signal received" });
    push({ type: "info", text: `Symbol: ${t.symbol}` });
    if (reason) push({ type: "info", text: `Reason: ${reason}` });
  },
  /** "executed/configured trades executed", plus the reason when some did not go through. */
  executed(tradeId: string, done: number, total: number, reason?: string) {
    push({ type: "status", status: done > 0 ? "filled" : "failed", tradeId, text: executedText(done, total) });
    if (journalHas(tradeId)) tradeLog.updateRecord(tradeId, done > 0 ? { outcome: "open" } : { outcome: "rejected", reasonExit: reason ?? "Not executed", closedAt: Date.now() });
    if (done < total && reason) push({ type: "error", tradeId, text: reason });
  },
  /** Logs a submission and returns a tradeId to correlate later status updates. */
  submit(t: TradeSubmit): string {
    const tradeId = crypto.randomUUID();
    push({ type: "trade", tradeId, text: `>> OPEN ${t.side}: ${t.symbol}  lot ${t.lot}` });
    push({ type: "trade", tradeId, text: `>> ENTRY @ ${t.entry}  ·  SL ${t.sl}  ·  TP ${t.tp}` });
    push({ type: "status", status: "submitted", tradeId, text: `>> [SUBMITTED] ${t.symbol} ${t.side} — awaiting broker…` });
    return tradeId;
  },
  filled(tradeId: string, detail?: string) {
    void detail;
    push({ type: "status", status: "filled", tradeId, text: ">> TRADE EXECUTED" });
  },
  failed(tradeId: string, reason: string) {
    push({ type: "status", status: "failed", tradeId, text: `>> [FAILED] ${reason}` });
  },
  closed(tradeId: string | undefined, detail: string) {
    push({ type: "status", status: "closed", tradeId, text: `>> [CLOSED] ${detail}` });
  },
  /** Back-compat shim. */
  trade(side: string, symbol: string, lot: string, entry: string, sl: string, tp: string) {
    return tradeLog.submit({ side, symbol, lot, entry, sl, tp });
  },
  info(text: string) { push({ type: "info", text }); },
  /** Updates one live line in place (scan countdown) so the log isn't flooded. */
  live(key: string, text: string) {
    text = stripTimeframes(text);
    const last = state.entries[state.entries.length - 1];
    if (last && last.live === key) {
      if (last.text === text) return;
      state = { ...state, entries: [...state.entries.slice(0, -1), { ...last, text, ts: Date.now() }] };
      emit();
      return;
    }
    // Drop any older copy of this live line, then append it at the bottom.
    state = { ...state, entries: state.entries.filter((e) => e.live !== key) };
    push({ type: "info", text, live: key });
  },
  error(text: string) { push({ type: "error", text }); },
  /** Stores a structured journal record; `announce` also writes a short line in the visible log. */
  record(r: Omit<JournalRecord, "id" | "ts"> & { id?: string; ts?: number }, announce = true): string {
    const rec: JournalRecord = { ...r, id: r.id ?? crypto.randomUUID(), ts: r.ts ?? Date.now() };
    saveJournal([...loadJournal().filter((x) => x.id !== rec.id), rec]);
    if (announce) push({ type: rec.kind === "trade" ? "trade" : "info", text: journalLine(rec) });
    return rec.id;
  },
  updateRecord(id: string, patch: Partial<JournalRecord>, line?: string) {
    saveJournal(loadJournal().map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (line) push({ type: patch.outcome === "loss" ? "error" : patch.outcome === "win" ? "success" : "info", text: line });
  },
  journal() { return loadJournal(); },
  clearJournal() { saveJournal([]); },
  togglePanel() { state = { ...state, panelOpen: !state.panelOpen }; emit(); },
  closePanel() { state = { ...state, panelOpen: false }; emit(); },
  clear() { state = { ...state, entries: [] }; emit(); },
};

const journalHas = (id: string) => loadJournal().some((x) => x.id === id);
function journalLine(r: JournalRecord) {
  const side = r.side === "SELL" ? "Sell" : "Buy";
  if (r.kind === "signal") return `${r.stage === "confirmed" ? "Confirmed" : "Early"} ${side} signal: ${r.symbol} · ${r.strategy}${r.confidence !== undefined ? ` · score ${r.confidence}` : ""}`;
  return `${r.mode === "paper" ? "Paper" : r.mode === "live" ? "Live" : ""} ${side} ${r.symbol} · ${r.strategy}${r.entry !== undefined ? ` @ ${r.entry}` : ""}`.trim();
}

/* ---------------- Trade Log window views (SCRIPT / LIVE) ---------------- */

export type LogView = "script" | "live";
/** LIVE keeps only signal, order and execution lines; SCRIPT shows every line. */
export const isLiveEntry = (e: Pick<LogEntry, "type" | "status">) => e.type === "trade" || e.status !== undefined;
export function entriesForView<T extends Pick<LogEntry, "type" | "status">>(entries: T[], view: LogView): T[] {
  return view === "live" ? entries.filter(isLiveEntry) : entries;
}
/** Line clock shown before each Trade Log line, e.g. "09:38:35" (device time). */
export function logClock(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
/** Line colour group: errors red, waiting orders amber, everything else terminal green. */
export function logTone(e: Pick<LogEntry, "type" | "status">): "error" | "pending" | "ok" {
  if (e.status === "failed" || e.type === "error") return "error";
  if (e.status === "submitted") return "pending";
  return "ok";
}

/** Non-React access for the Android floating Trade Log bridge. */
export const subscribeTradeLog = subscribe;
export const getTradeLogState = get;
