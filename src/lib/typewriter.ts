/**
 * Sequential Trade Log typing (pure). New lines are typed one at a time, character by character,
 * in the order they arrived; a line waits hidden until the one before it has finished.
 * Lines already on screen when the log opens are shown at once (history), and a finished line
 * whose text later changes in place (the live scan countdown) updates instantly.
 * The Android floating Trade Log (OverlayService.java) follows the same rules.
 */
export interface TypingLine { id: string; text: string }
export interface TypingState { done: Record<string, true>; current?: string; shown: number }

export const TYPE_TICK_MS = 30;

/** Everything currently in the log counts as already typed. */
export function typingHistory(lines: TypingLine[]): TypingState {
  const done: Record<string, true> = {};
  for (const l of lines) done[l.id] = true;
  return { done, shown: 0 };
}

/** Characters added per tick: one normally, faster when several lines are queued so typing never falls far behind. */
export function charsPerTick(backlogChars: number): number {
  if (backlogChars <= 120) return 1;
  return Math.min(6, Math.ceil(backlogChars / 120));
}

/** Advances the typing by one tick. */
export function typingStep(state: TypingState, lines: TypingLine[]): TypingState {
  const pending = lines.filter((l) => !state.done[l.id]);
  const next = pending[0];
  if (!next) return state.current === undefined && state.shown === 0 ? state : { done: state.done, shown: 0 };
  const shownBefore = state.current === next.id ? state.shown : 0;
  const backlog = pending.reduce((a, l) => a + l.text.length, 0) - shownBefore;
  const shown = shownBefore + charsPerTick(backlog);
  if (shown >= next.text.length) return { done: { ...state.done, [next.id]: true }, shown: 0 };
  return { done: state.done, current: next.id, shown };
}

/** Visible text of one line: full when typed, partial while typing, null while still waiting its turn. */
export function visibleText(state: TypingState, line: TypingLine): string | null {
  if (state.done[line.id]) return line.text;
  if (state.current === line.id) return line.text.slice(0, state.shown);
  return null;
}

export const isTyping = (state: TypingState, lines: TypingLine[]) => lines.some((l) => !state.done[l.id]);
