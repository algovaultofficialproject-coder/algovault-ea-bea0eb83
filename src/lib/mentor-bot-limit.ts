export const MENTOR_BOT_LIMIT = 1;

export function canAddMentorBot(bots: readonly unknown[]): boolean {
  return bots.length < MENTOR_BOT_LIMIT;
}

export function validateMentorBots(next: unknown, previous: unknown = []): void {
  if (!Array.isArray(next)) throw new Error("Invalid bot list.");
  if (next.length <= MENTOR_BOT_LIMIT) return;
  // Existing multi-bot workspaces can be edited or reduced, never expanded.
  const old = Array.isArray(previous) ? previous : [];
  const ids = new Set(old.map((bot) => bot?.id));
  if (next.length > old.length || next.some((bot) => !ids.has(bot?.id))) {
    throw new Error("You can only have one bot. Delete your current bot before adding another.");
  }
}