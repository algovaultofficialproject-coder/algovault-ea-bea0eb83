import { getProShared } from "./shared-config.functions";
import { homeRobotState } from "./shared-config";
import type { ProState } from "./store";

let cache: { at: number; state: ProState } | null = null;
const TTL = 60_000;

/** The admin's published setup for robots, refreshed at most once a minute; recommended setup if unreachable. */
export async function loadRobotProState(now = Date.now()): Promise<ProState> {
  if (cache && now - cache.at < TTL) return cache.state;
  try {
    const { value } = await getProShared();
    let config: unknown = null;
    try { config = value ? JSON.parse(value) : null; } catch { config = null; }
    cache = { at: now, state: homeRobotState(config) };
  } catch {
    if (!cache) return homeRobotState(null);
  }
  return cache.state;
}
