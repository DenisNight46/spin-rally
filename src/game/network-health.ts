export const NETWORK_HEARTBEAT_INTERVAL_MS = 2_000;
export const NETWORK_HEARTBEAT_TIMEOUT_MS = 8_000;
export const NETWORK_CONNECT_TIMEOUT_MS = 10_000;

/** True when a socket has stopped acknowledging heartbeats for too long. */
export function isHeartbeatTimedOut(lastPongAt: number, now: number, timeoutMs = NETWORK_HEARTBEAT_TIMEOUT_MS): boolean {
  return Number.isFinite(lastPongAt) && Number.isFinite(now) && Number.isFinite(timeoutMs)
    ? now - lastPongAt >= Math.max(0, timeoutMs)
    : false;
}
