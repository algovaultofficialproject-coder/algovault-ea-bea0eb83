export function selectionAfterRemoval(robots: Array<{ id: string }>, activeId: string | null, removedId: string) {
  const remaining = robots.filter((robot) => robot.id !== removedId);
  return { remaining, activeId: activeId === removedId ? remaining[0]?.id ?? null : activeId };
}