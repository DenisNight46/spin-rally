import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket from "ws";
import { attachRealtime, isAllowedWebSocketOrigin, isValidPaddleInput, isReconnectExpired, isWaitingRoomExpired } from "./realtime";
import { DEFAULT_SETTINGS } from "../contracts/sim";
import type { ServerMessage } from "../contracts/network";

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  const closing = sockets.splice(0).map((socket) => new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", () => resolve());
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  }));
  await Promise.all(closing);
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function waitFor(socket: WebSocket, predicate: (message: ServerMessage) => boolean, timeoutMs = 2500): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      let message: ServerMessage;
      try { message = JSON.parse(raw.toString()) as ServerMessage; }
      catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

describe("online room protocol", () => {
  it("expires abandoned one-player lobbies after 15 minutes but keeps active rooms alive", () => {
    const now = 1_000_000;
    expect(isWaitingRoomExpired(1, now, now + 14 * 60_000)).toBe(false);
    expect(isWaitingRoomExpired(1, now, now + 15 * 60_000)).toBe(true);
    expect(isWaitingRoomExpired(2, now, now + 60 * 60_000)).toBe(false);
    expect(isWaitingRoomExpired(0, now, now + 15 * 60_000)).toBe(true);
  });

  it("expires a reserved reconnect seat only after the grace period", () => {
    const disconnectedAt = 50_000;
    expect(isReconnectExpired(disconnectedAt, disconnectedAt + 29_999)).toBe(false);
    expect(isReconnectExpired(disconnectedAt, disconnectedAt + 30_000)).toBe(true);
    expect(isReconnectExpired(Number.NaN, disconnectedAt + 30_000)).toBe(false);
  });

  it("accepts only same-host browser WebSocket origins", () => {
    expect(isAllowedWebSocketOrigin(undefined, "spin-rally.onrender.com")).toBe(true);
    expect(isAllowedWebSocketOrigin("https://spin-rally.onrender.com", "spin-rally.onrender.com")).toBe(true);
    expect(isAllowedWebSocketOrigin("https://spin-rally.onrender.com.evil.test", "spin-rally.onrender.com")).toBe(false);
    expect(isAllowedWebSocketOrigin("not a URL", "spin-rally.onrender.com")).toBe(false);
    expect(isAllowedWebSocketOrigin("https://example.com", undefined)).toBe(false);
  });

  it("rejects malformed or non-finite paddle input before it reaches simulation", () => {
    const valid = { x: 0.2, y: 1.3, z: 1.48, power: false, slice: true, serve: false };
    expect(isValidPaddleInput(valid)).toBe(true);
    expect(isValidPaddleInput({ ...valid, x: Number.NaN })).toBe(false);
    expect(isValidPaddleInput({ ...valid, z: 3 })).toBe(false);
    expect(isValidPaddleInput({ ...valid, serve: "yes" })).toBe(false);
    expect(isValidPaddleInput({ ...valid, swingY: 8 })).toBe(true);
    expect(isValidPaddleInput({ ...valid, swingY: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidPaddleInput({ ...valid, swingY: 9 })).toBe(false);
    expect(isValidPaddleInput(null)).toBe(false);
  });
  it("creates an invite room, joins a second player, exchanges state and ping, then reports disconnect", async () => {
    const server = createServer();
    servers.push(server);
    attachRealtime(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No ephemeral HTTP port");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const host = await openSocket(url);

    // Valid JSON is not necessarily a valid protocol envelope. These packets
    // must produce a controlled error and must not crash the WS message handler.
    for (const packet of ["null", "[]", "42", '{"type":42}', '{"type":"unknown"}']) {
      const errorPromise = waitFor(host, (m) => m.type === "error");
      host.send(packet);
      const error = await errorPromise;
      expect(error.type).toBe("error");
    }

    const hostJoinedPromise = waitFor(host, (m) => m.type === "joined");
    host.send(JSON.stringify({ type: "create", settings: DEFAULT_SETTINGS }));
    const hostJoined = await hostJoinedPromise;
    expect(hostJoined.type).toBe("joined");
    if (hostJoined.type !== "joined") throw new Error("Host did not receive room id");
    expect(hostJoined.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    // A failed attempt to switch rooms must not evict the player from their
    // current lobby; joining the same room twice must be idempotent.
    const missingRoomError = waitFor(host, (m) => m.type === "error");
    host.send(JSON.stringify({ type: "join", roomId: "ZZZZZZ", settings: DEFAULT_SETTINGS }));
    expect((await missingRoomError).type).toBe("error");

    const repeatedJoin = waitFor(host, (m) => m.type === "joined");
    host.send(JSON.stringify({ type: "join", roomId: hostJoined.roomId, settings: DEFAULT_SETTINGS }));
    const repeated = await repeatedJoin;
    expect(repeated.type).toBe("joined");
    if (repeated.type === "joined") {
      expect(repeated.side).toBe(0);
      if (hostJoined.type === "joined") expect(repeated.token).toBe(hostJoined.token);
    }

    const guest = await openSocket(url);
    const guestJoinedPromise = waitFor(guest, (m) => m.type === "joined");
    const hostPeerPromise = waitFor(host, (m) => m.type === "state" && m.peerConnected);
    guest.send(JSON.stringify({ type: "join", roomId: hostJoined.roomId, settings: { ...DEFAULT_SETTINGS, name: "Guest" } }));
    const guestJoined = await guestJoinedPromise;
    expect(guestJoined.type).toBe("joined");
    if (guestJoined.type === "joined") expect(guestJoined.side).toBe(1);
    const hostState = await hostPeerPromise;
    expect(hostState.type).toBe("state");
    if (hostState.type === "state") expect(hostState.players[1].name).toBe("Guest");

    const pongPromise = waitFor(host, (m) => m.type === "pong");
    host.send(JSON.stringify({ type: "ping", at: 123 }));
    const pong = await pongPromise;
    expect(pong.type).toBe("pong");
    if (pong.type === "pong") expect(pong.at).toBe(123);

    const resumeToken = guestJoined.type === "joined" ? guestJoined.token : "";
    const disconnectedPromise = waitFor(host, (m) => m.type === "state" && !m.peerConnected);
    guest.close();
    const disconnected = await disconnectedPromise;
    expect(disconnected.type).toBe("state");

    // The match and seat survive a short network interruption. Invalid tokens
    // cannot claim the reserved seat; the original token restores the same side.
    const returningGuest = await openSocket(url);
    const rejectedResume = waitFor(returningGuest, (m) => m.type === "error");
    returningGuest.send(JSON.stringify({ type: "resume", roomId: hostJoined.roomId, token: "invalid-token" }));
    expect((await rejectedResume).type).toBe("error");

    const resumedPromise = waitFor(returningGuest, (m) => m.type === "joined");
    const hostReconnectedPromise = waitFor(host, (m) => m.type === "state" && m.peerConnected);
    returningGuest.send(JSON.stringify({ type: "resume", roomId: hostJoined.roomId, token: resumeToken }));
    const resumed = await resumedPromise;
    expect(resumed.type).toBe("joined");
    if (resumed.type === "joined") {
      expect(resumed.side).toBe(1);
      expect(resumed.token).toBe(resumeToken);
    }
    const hostReconnected = await hostReconnectedPromise;
    expect(hostReconnected.type).toBe("state");
    if (hostReconnected.type === "state") {
      expect(hostReconnected.state.scores).toEqual([0, 0]);
      expect(hostReconnected.state.phase).toBe("serve");
    }

    // A reconnect can beat the server's TCP close notification. A valid
    // session token must atomically replace the stale socket without freeing
    // the seat or resetting the match.
    const replacement = await openSocket(url);
    const replacementJoinedPromise = waitFor(replacement, (m) => m.type === "joined");
    const oldSocketClosed = new Promise<void>((resolve) => returningGuest.once("close", () => resolve()));
    const takeoverState = waitFor(host, (m) => m.type === "state" && m.peerConnected);
    replacement.send(JSON.stringify({ type: "resume", roomId: hostJoined.roomId, token: resumeToken }));
    const replacementJoined = await replacementJoinedPromise;
    expect(replacementJoined.type).toBe("joined");
    if (replacementJoined.type === "joined") expect(replacementJoined.side).toBe(1);
    await oldSocketClosed;
    expect((await takeoverState).type).toBe("state");
  });
});
