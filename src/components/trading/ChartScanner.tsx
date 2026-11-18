import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ChevronDown, Clock, Crosshair, Loader2, Scan, Sparkles, Target, Timer, Upload, Zap, Check, History, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePortalStore } from "@/lib/portal-store";
import { tradeLog } from "@/lib/trade-log";
import { getScanUsage, scanChart } from "@/lib/scan-chart.functions";
import { getSmartSignal } from "@/lib/smart-signal.functions";
import { getCandles } from "@/lib/market-data.functions";
import { executeTrade } from "@/lib/metaapi.functions";
import { proToChart, scanProSignal, type CandlesFn } from "@/lib/autotrader-pro/pro-signal";
import { getGeminiVerdict } from "@/lib/gemini.functions";
import { loadRobotProState } from "@/lib/autotrader-pro/shared-config-client";
import { SCAN_STRATEGIES, fmtPrice, levelPositions, loadHistory, pushHistory, saveHistory, strategyName, tfLabel, type HistoryItem, type ScanStrategyId } from "@/lib/chart-scan-view";

type EA = ReturnType<typeof usePortalStore>["eas"][number] | null;
type Sig = {
  symbol: string; timeframe: string; timeframeSource?: string; strategy?: string; side: string; entry: number; stopLoss: number; takeProfit: number; confidence: string;
  noChart?: boolean; confidencePct?: number; rationale: string; trend?: string; structure?: string; riskReward?: number; patterns?: string[];
  warnings?: string[]; model?: string; confluences?: string[]; grade?: string;
};
const FALLBACK = ["XAUUSD", "US30", "USTECH", "DE30", "USDJPY", "EURUSD"];

/** Chart scanner inside the settings drawer: uploads are read by the AI with the AutoTrader Pro method; only Execute sends orders. */
export function ChartScanner({ activeEA }: { activeEA: EA }) {
  const { metaAccountId, metaPlatform, metaLogin, metaPassword, metaServer, activatedEmail } = usePortalStore();
  const usageFn = useServerFn(getScanUsage);
  const scanFn = useServerFn(scanChart);
  const smartScanFn = useServerFn(getSmartSignal);
  const candlesFn = useServerFn(getCandles) as unknown as CandlesFn;
  const gemini = useServerFn(getGeminiVerdict);
  const execFn = useServerFn(executeTrade);
  const [chart, setChart] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [signal, setSignal] = useState<Sig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<ScanStrategyId>("auto");
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const [symbolChoice, setSymbolChoice] = useState("AUTO");
  const [manualSymbol, setManualSymbol] = useState("");
  const [lotSize, setLotSize] = useState("0.01");
  const [numTrades, setNumTrades] = useState("1");
  const [exec, setExec] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [execMsg, setExecMsg] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => setHistory(loadHistory()), []);
  useEffect(() => {
    if (!activatedEmail) return;
    usageFn({ data: { email: activatedEmail } }).then(setUsage).catch(() => undefined);
  }, [activatedEmail, usageFn]);

  const execPlatform: "MT4" | "MT5" = String(metaPlatform ?? "mt4").toUpperCase() === "MT5" ? "MT5" : "MT4";
  const allowed = (activeEA?.symbols ?? []).filter((s) => s.allowed).map((s) => s.symbol);
  const others = (activeEA?.symbols ?? []).filter((s) => !s.allowed).map((s) => s.symbol);
  const tradable = Array.from(new Set([...allowed, ...others, ...(signal?.symbol ? [signal.symbol] : [])]));
  const scanSymbols = tradable.length ? tradable : FALLBACK;
  const limitReached = !!usage && usage.used >= usage.limit;

  function applyPreset(sym: string) {
    const p = activeEA?.symbols.find((x) => x.symbol.toLowerCase() === sym.toLowerCase());
    if (p?.lotSize) setLotSize(p.lotSize);
    if (p?.trades) setNumTrades(p.trades);
  }
  function done(sig: Sig) {
    setSignal(sig); setManualSymbol(sig.symbol); applyPreset(sig.symbol);
    if (sig.side === "BUY" || sig.side === "SELL") {
      const next = pushHistory(history, { at: Date.now(), symbol: sig.symbol, side: sig.side, entry: sig.entry, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit, confidence: sig.confidencePct, timeframe: tfLabel(sig.timeframe) });
      setHistory(next); saveHistory(next);
    }
  }
  function reset() { setChart(null); setSignal(null); setErr(null); setExec("idle"); }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setChart(r.result as string);
    r.readAsDataURL(f);
    setSignal(null); setExec("idle"); setErr(null);
  }

  /** Upload scan: the AI reads this chart itself (timeframe, structure, levels) — no live AutoTrader Pro signal is mixed in. */
  async function analyze() {
    if (!chart) return;
    if (!activatedEmail) { setErr("Sign in to the trading app to scan charts."); return; }
    setScanning(true); setSignal(null); setErr(null); setExec("idle");
    try {
      const chosen = symbolChoice !== "AUTO" ? symbolChoice : undefined;
      const out = await scanFn({ data: { imageDataUrl: chart, strategy, symbol: chosen, email: activatedEmail } });
      setUsage(out.usage);
      done({ ...(out as unknown as Sig), symbol: chosen ?? out.symbol });
    } catch (e) { setErr(e instanceof Error ? e.message : "AI scan failed"); }
    finally { setScanning(false); }
  }

  /** Live scan: AutoTrader Pro first (every 1m–1h frame), AI timeframe scan as fallback. */
  async function analyzeLive() {
    const symbol = symbolChoice === "AUTO" ? (manualSymbol || allowed[0] || "") : symbolChoice;
    if (!symbol) { setErr("Choose a symbol for live scanning."); return; }
    setScanning(true); setSignal(null); setErr(null); setExec("idle");
    try {
      const pro = await scanProSignal(symbol, candlesFn, Date.now(), await loadRobotProState(), (sym) => gemini({ data: { symbol: sym } })).catch(() => null);
      if (pro?.ok) { done(proToChart(symbol, pro)); return; }
      const out = await smartScanFn({ data: { symbol } });
      if (!out.ok) { setErr(out.error ?? "Live scan unavailable."); return; }
      done({ symbol, timeframe: out.timeframe ?? "1h", side: out.side, entry: out.entry, stopLoss: out.stopLoss, takeProfit: out.takeProfit, confidence: out.confidence >= 70 ? "high" : "low", confidencePct: out.confidence, rationale: `${out.reason} ${out.timeframeReason ?? ""}`, riskReward: out.rewardRisk, confluences: out.ruleReasons, model: "Live TradingView AI", warnings: ["Profits are not guaranteed."] });
    } catch (e) { setErr(e instanceof Error ? e.message : "Live scan failed."); }
    finally { setScanning(false); }
  }

  async function execute() {
    if (!signal || (signal.side !== "BUY" && signal.side !== "SELL")) { setExec("err"); setExecMsg("No confirmed trade setup."); return; }
    const sym = (manualSymbol || signal.symbol || "").trim();
    const side: "BUY" | "SELL" = signal.side;
    if (!sym) { setExec("err"); setExecMsg("Choose a symbol first."); return; }
    if (!metaAccountId || !metaLogin || !metaPassword || !metaServer) { setExec("err"); setExecMsg("Connect MetaTrader first (MetaTrader tab)."); return; }
    setExec("sending"); setExecMsg("Executing trades…");
    const n = Math.max(1, Math.min(20, parseInt(numTrades) || 1));
    const tradeId = tradeLog.signal({ side, symbol: sym, sl: signal.stopLoss || "—", tp: signal.takeProfit || "—" });
    try {
      const res = await execFn({ data: {
        platform: execPlatform.toLowerCase() as "mt4" | "mt5", login: metaLogin, password: metaPassword, server: metaServer,
        symbol: sym, side, lot: Number(lotSize), sl: signal.stopLoss || undefined, tp: signal.takeProfit || undefined,
        comment: `${activeEA?.name ?? "chart scanner"}~AlgoVault`, count: n,
      } });
      const results = (res as unknown as { results?: Array<{ ok: boolean; error?: string }> }).results ?? [];
      const ok = results.filter((r) => r.ok).length, fail = results.length - ok;
      tradeLog.executed(tradeId, ok, n, results.find((r) => !r.ok)?.error ?? (res as { error?: string }).error);
      setExec(fail && !ok ? "err" : "ok");
      setExecMsg(`✓ Filled ${ok}/${n}${fail ? ` · ${fail} failed` : ""}`);
    } catch (e) {
      tradeLog.executed(tradeId, 0, n, e instanceof Error ? e.message : "Network error");
      setExec("err"); setExecMsg(e instanceof Error ? e.message : "network error");
    }
  }

  const tf = tfLabel(signal?.timeframe);
  const pct = typeof signal?.confidencePct === "number" ? Math.round(signal.confidencePct) : null;
  const tone = signal?.side === "SELL" ? "is-sell" : signal?.side === "BUY" ? "is-buy" : "is-wait";
  const lines = signal && signal.side !== "WAIT" ? levelPositions(signal) : null;
  const strat = signal ? strategyName(signal) : "";

  return (
    <div className={`scanx ${tone}`}>
      <div className="scanx-head">
        <span>AI-powered chart analysis<small>Smart scan · AutoTrader Pro method</small></span>
        <span className={`scanx-chip ${limitReached ? "is-full" : ""}`}>{usage ? `${usage.used}/${usage.limit}` : "—"} Scans</span>
      </div>

      {!signal && (
        <>
          <label className="scanx-upload">
            {chart ? <img src={chart} alt="Uploaded chart" /> : (
              <span className="scanx-upload-empty"><span className="scanx-upload-icon"><Upload /></span><strong>Upload chart screenshot</strong><small>PNG · JPG · WebP</small></span>
            )}
            <input type="file" accept="image/*" onChange={onFile} hidden />
          </label>

          <p className="scanx-label">Symbol</p>
          <div className="scanx-pills">
            {["AUTO", ...scanSymbols].map((s) => (
              <button key={s} type="button" className={`scanx-pill ${symbolChoice === s ? "is-on" : ""}`} onClick={() => setSymbolChoice(s)}>{s === "AUTO" ? "Auto" : s}</button>
            ))}
          </div>

          <p className="scanx-label">Strategy</p>
          <div className="scanx-pills scanx-mode" role="radiogroup" aria-label="Strategy">
            {SCAN_STRATEGIES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={strategy === m.id} className={`scanx-pill ${strategy === m.id ? "is-on" : ""}`} onClick={() => setStrategy(m.id)}>{m.label}</button>
            ))}
          </div>
          <p className="scanx-note">Timeframe is detected automatically from your chart.</p>

          <button type="button" className="scanx-cta" disabled={!chart || scanning || limitReached} onClick={analyze}>
            {scanning ? <><Loader2 className="animate-spin" /> Analyzing…</> : limitReached ? <>Daily limit reached</> : <><Scan /> Scan &amp; Analyze</>}
          </button>
          <button type="button" className="scanx-ghost" disabled={scanning} onClick={analyzeLive}><Activity /> Scan live market</button>
          {scanning && <Analyzing />}
        </>
      )}
      {err && <p className="scanx-err">{err}</p>}

      {signal && (
        <>
          {chart && (
            <div className="scanx-preview">
              <img src={chart} alt="Scanned chart" />
              <span className="scanx-side-tag">{signal.side === "SELL" ? "▼" : signal.side === "BUY" ? "▲" : "■"} {signal.noChart ? "NO TRADE" : `${signal.side} ${signal.symbol}`}</span>
              <span className="scanx-conf-tag">{pct !== null ? `${pct}% · ` : ""}{tf}</span>
              {lines && <>
                <span className="scanx-line is-sl" style={{ top: `${lines.sl}%` }}><b>SL {fmtPrice(signal.stopLoss)}</b></span>
                <span className="scanx-line is-entry" style={{ top: `${lines.entry}%` }}><b>ENTRY {fmtPrice(signal.entry)}</b></span>
                <span className="scanx-line is-tp" style={{ top: `${lines.tp}%` }}><b>TP {fmtPrice(signal.takeProfit)}</b></span>
              </>}
            </div>
          )}

          <div className="scanx-brief">
            <strong>{signal.noChart ? "NO TRADE — no chart detected" : signal.side === "WAIT" ? "NO CONFIRMED SETUP" : `${strat} entry`}</strong>
            <p>{signal.rationale}</p>
          </div>

          <div className="scanx-card">
            <div className="scanx-card-top">
              <h3>{signal.noChart ? "No chart" : signal.symbol}</h3>
              <span className="scanx-side">{signal.noChart ? "NO TRADE" : signal.side}</span>
            </div>
            {signal.side !== "WAIT" && (
              <div className="scanx-levels">
                <span className="is-entry"><small><Sparkles /> Entry</small><b>{fmtPrice(signal.entry)}</b></span>
                <span className="is-sl"><small><Crosshair /> SL</small><b>{fmtPrice(signal.stopLoss)}</b></span>
                <span className="is-tp"><small><Target /> TP</small><b>{fmtPrice(signal.takeProfit)}</b></span>
              </div>
            )}
            {!signal.noChart && <>
            <div className="scanx-facts">
              <span><small><Zap /> Strategy</small><b>{strat}</b></span>
              <span><small><Timer /> Timeframe</small><b>{tf}{signal.timeframeSource === "estimated" ? " (est.)" : ""}</b></span>
              <span><small><Check /> Confidence</small><b>{pct !== null ? `${pct}%` : signal.confidence}</b></span>
              <span><small><Activity /> Reward : Risk</small><b>{signal.riskReward ? `1:${signal.riskReward}` : "—"}</b></span>
            </div>
            {!!signal.warnings?.length && <ul className="scanx-warn">{signal.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
            <p className="scanx-by">Signal by <b>{activeEA?.name ?? "AlgoVault"}</b> · {signal.model ?? "AI"}</p>

            <p className="scanx-label is-center">Choose symbol to trade</p>
            <div className="scanx-pills is-center">
              {scanSymbols.map((s) => (
                <button key={s} type="button" className={`scanx-pill ${manualSymbol.toLowerCase() === s.toLowerCase() ? "is-on" : ""}`} onClick={() => { setManualSymbol(s); applyPreset(s); }}>{s}</button>
              ))}
            </div>
            <Input value={manualSymbol} onChange={(e) => setManualSymbol(e.target.value)} placeholder="or type the broker symbol e.g. XAUUSDm" className="scanx-input" />

            <p className="scanx-label is-center">Select number of trades</p>
            <div className="scanx-count">
              {["1", "3", "7", "9"].map((n) => (
                <button key={n} type="button" className={numTrades === n ? "is-on" : ""} onClick={() => setNumTrades(n)}>{n}</button>
              ))}
            </div>

            <p className="scanx-label is-center">Lot size {metaAccountId ? `· ${execPlatform} connected` : "· connect MetaTrader to execute"}</p>
            <Input value={lotSize} onChange={(e) => setLotSize(e.target.value)} inputMode="decimal" className="scanx-input" />

            <button type="button" className="scanx-exec" onClick={execute} disabled={exec === "sending" || !manualSymbol.trim() || signal.side === "WAIT"}>
              {exec === "sending" ? <span><Loader2 className="animate-spin" /> Executing…</span> : <>
                <span><Upload /> {signal.noChart ? "No trade — no chart" : signal.side === "WAIT" ? "Wait — no setup" : `Execute ${numTrades} trade${numTrades === "1" ? "" : "s"}`}</span>
                <small>{signal.side} on {manualSymbol || signal.symbol}</small>
              </>}
            </button>
            {exec !== "idle" && <p className={`scanx-exec-msg is-${exec}`}>{execMsg}</p>}
            </>}
          </div>

          <button type="button" className="scanx-ghost" onClick={reset}><RotateCcw /> Scan another chart</button>
        </>
      )}

      <div className="scanx-history">
        <button type="button" className="scanx-history-head" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
          <History /> <span>Scan History</span> <ChevronDown className={historyOpen ? "rotate-180" : ""} />
        </button>
        {historyOpen && (history.length ? (
          <ul>
            {history.map((h) => (
              <li key={h.at} className={h.side === "SELL" ? "is-sell" : "is-buy"}>
                <span className="scanx-history-side">{h.side}</span>
                <span className="scanx-history-main"><b>{h.symbol}</b><small><Clock /> {new Date(h.at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {h.timeframe}{h.confidence ? ` · ${Math.round(h.confidence)}%` : ""}</small></span>
                <span className="scanx-history-lv"><small>E {fmtPrice(h.entry)}</small><small>SL {fmtPrice(h.stopLoss)}</small><small>TP {fmtPrice(h.takeProfit)}</small></span>
              </li>
            ))}
          </ul>
        ) : <p className="scanx-empty">No scans yet — your last {10} signals appear here.</p>)}
      </div>
    </div>
  );
}

function Analyzing() {
  const steps = ["Reading chart & timeframe", "Mapping HTF bias", "Detecting BOS / CHoCH", "Marking liquidity & OBs", "Applying the strategy", "Scoring the setup"];
  const [idx, setIdx] = useState(0);
  useEffect(() => { const t = setInterval(() => setIdx((i) => Math.min(i + 1, steps.length - 1)), 900); return () => clearInterval(t); }, [steps.length]);
  return (
    <ul className="scanx-steps">
      {steps.map((s, i) => <li key={s} className={i < idx ? "is-done" : i === idx ? "is-active" : ""}><span>{i < idx ? <Check /> : null}</span>{s}</li>)}
    </ul>
  );
}
