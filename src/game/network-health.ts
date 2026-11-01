export const NETWORK_HEARTBEAT_INTERVAL_MS = 2_000;
export const NETWORK_HEARTBEAT_TIMEOUT_MS = 8_000;
export const NETWORK_CONNECT_TIMEOUT_MS = 10_000;
export const NETWORK_RECONNECT_WINDOW_MS = 25_000;
export const NETWORK_RECONNECT_INITIAL_DELAY_MS = 500;
export const NETWORK_RECONNECT_MAX_DELAY_MS = 2_500;

/** True when a socket has stopped acknowledging heartbeats for too long. */
export function isHeartbeatTimedOut(lastPongAt: number, now: number, timeoutMs = NETWORK_HEARTBEAT_TIMEOUT_MS): boolean {
  return Number.isFinite(lastPongAt) && Number.isFinite(now) && Number.isFinite(timeoutMs)
    ? now - lastPongAt >= Math.max(0, timeoutMs)
    : false;
}

/** Exponential retry with a cap, keeping reconnect attempts predictable and bounded. */
export function getReconnectDelay(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return NETWORK_RECONNECT_INITIAL_DELAY_MS;
  return Math.min(NETWORK_RECONNECT_MAX_DELAY_MS, NETWORK_RECONNECT_INITIAL_DELAY_MS * 2 ** Math.floor(attempt));
}

/** The client stops retrying before the server releases the reserved player seat. */
export function isReconnectWindowOpen(startedAt: number, now: number): boolean {
  return Number.isFinite(startedAt) && Number.isFinite(now)
    && now >= startedAt && now - startedAt < NETWORK_RECONNECT_WINDOW_MS;
}
