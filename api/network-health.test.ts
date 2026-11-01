import { describe, expect, it } from "vitest";
import {
  getReconnectDelay,
  isHeartbeatTimedOut,
  isReconnectWindowOpen,
  NETWORK_RECONNECT_MAX_DELAY_MS,
  NETWORK_RECONNECT_WINDOW_MS,
} from "../src/game/network-health";

describe("network recovery policy", () => {
  it("backs off reconnect attempts without exceeding the retry cap", () => {
    expect(getReconnectDelay(0)).toBe(500);
    expect(getReconnectDelay(1)).toBe(1_000);
    expect(getReconnectDelay(2)).toBe(2_000);
    expect(getReconnectDelay(3)).toBe(NETWORK_RECONNECT_MAX_DELAY_MS);
    expect(getReconnectDelay(-1)).toBe(500);
  });

  it("bounds reconnect attempts to a finite window", () => {
    expect(isReconnectWindowOpen(10_000, 10_000)).toBe(true);
    expect(isReconnectWindowOpen(10_000, 10_000 + NETWORK_RECONNECT_WINDOW_MS - 1)).toBe(true);
    expect(isReconnectWindowOpen(10_000, 10_000 + NETWORK_RECONNECT_WINDOW_MS)).toBe(false);
    expect(isReconnectWindowOpen(10_000, 9_999)).toBe(false);
  });

  it("detects stale heartbeats without treating invalid clocks as a timeout", () => {
    expect(isHeartbeatTimedOut(1_000, 9_000)).toBe(true);
    expect(isHeartbeatTimedOut(1_000, 8_999)).toBe(false);
    expect(isHeartbeatTimedOut(Number.NaN, 9_000)).toBe(false);
  });
});
