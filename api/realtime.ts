import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "../contracts/network";
import { DEFAULT_SETTINGS, TableTennisSim, type PaddleInput, type PlayerSettings, type Side } from "../contracts/sim";

interface ClientSocket extends WebSocket {
  room?: Room;
  side?: Side;
  settings?: PlayerSettings;
  lastInputAt?: number;
}

interface PlayerSlot {
  socket: ClientSocket | null;
  settings: PlayerSettings;
  token: string;
  disconnectedAt: number | null;
}

interface Room {
  id: string;
  players: [PlayerSlot | null, PlayerSlot | null];
  sim: TableTennisSim;
  tick: number;
  accumulator: number;
  lastTickAt: number;
  lastActivityAt: number;
  rematchVotes: Set<Side>;
}

const rooms = new Map<string, Room>();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ROOM_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const RECONNECT_GRACE_MS = 30 * 1000;

export function isReconnectExpired(disconnectedAt: number, now: number): boolean {
  return Number.isFinite(disconnectedAt) && Number.isFinite(now)
    ? now - disconnectedAt >= RECONNECT_GRACE_MS
    : false;
}

/** A one-player lobby expires only after its connected client stops sending activity. */
export function isWaitingRoomExpired(
  connectedPlayers: number,
  lastActivityAt: number,
  now: number,
): boolean {
  return connectedPlayers < 2 && now - lastActivityAt >= ROOM_IDLE_TIMEOUT_MS;
}

function makeCode(): string {
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

function cleanSettings(value: unknown): PlayerSettings {
  const source = value && typeof value === "object" ? value as Partial<PlayerSettings> : {};
  const color = (input: unknown, fallback: string) => typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback;
  return {
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 16) : DEFAULT_SETTINGS.name,
    kit: color(source.kit, DEFAULT_SETTINGS.kit),
    paddle: color(source.paddle, DEFAULT_SETTINGS.paddle),
    ball: color(source.ball, DEFAULT_SETTINGS.ball),
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function players(room: Room): [PlayerSettings, PlayerSettings] {
  return [
    room.players[0]?.settings ?? { ...DEFAULT_SETTINGS, name: "Игрок 1" },
    room.players[1]?.settings ?? { ...DEFAULT_SETTINGS, name: "Игрок 2" },
  ];
}

function broadcastState(room: Room): void {
  const message: ServerMessage = {
    type: "state",
    state: room.sim.state,
    players: players(room),
    peerConnected: Boolean(room.players[0]?.socket && room.players[1]?.socket),
  };
  for (const player of room.players) if (player?.socket) send(player.socket, message);
}

function resetForWaitingPlayer(room: Room): void {
  room.rematchVotes.clear();
  room.sim = new TableTennisSim(randomInt(1, 2 ** 30));
  room.sim.state.message = "Соперник отключился. Ожидание нового игрока";
  broadcastState(room);
}

/** Explicit room changes release a seat; an unexpected socket loss reserves it briefly. */
function leave(socket: ClientSocket, preserveForReconnect = false): void {
  const room = socket.room;
  if (!room || socket.side === undefined) return;
  const side = socket.side;
  const slot = room.players[side];
  socket.room = undefined;
  socket.side = undefined;
  if (!slot || slot.socket !== socket) return;
  if (preserveForReconnect) {
    slot.socket = null;
    slot.disconnectedAt = Date.now();
    room.sim.state.message = "Соединение потеряно. Ожидаем переподключения игрока";
    broadcastState(room);
    return;
  }
  room.players[side] = null;
  if (!room.players[0] && !room.players[1]) {
    rooms.delete(room.id);
    return;
  }
  resetForWaitingPlayer(room);
}

function tokensMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Browser WebSocket handshakes must come from the same host; non-browser clients may omit Origin. */
export function isAllowedWebSocketOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function isValidPaddleInput(input: unknown): input is PaddleInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<PaddleInput>;
  return ["x", "y", "z"].every((key) => {
    const coordinate = value[key as "x" | "y" | "z"];
    return typeof coordinate === "number" && Number.isFinite(coordinate) && Math.abs(coordinate) < 3;
  }) && ["power", "slice", "serve"].every((key) => typeof value[key as "power" | "slice" | "serve"] === "boolean")
    && (value.swingY === undefined || (typeof value.swingY === "number" && Number.isFinite(value.swingY) && Math.abs(value.swingY) <= 8))
    && (value.swingZ === undefined || (typeof value.swingZ === "number" && Number.isFinite(value.swingZ) && Math.abs(value.swingZ) <= 8));
}

export function attachRealtime(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (request, socket, head) => {
    let pathname = "/";
    try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; }
    catch { socket.destroy(); return; }
    if (pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (socket: ClientSocket) => {
    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString()) as unknown;
      } catch {
        send(socket, { type: "error", message: "Некорректное сообщение" });
        return;
      }
      // JSON.parse also accepts null, arrays and primitives. Reject these before
      // reading .type so a malformed packet cannot throw inside the WS event loop.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || typeof (parsed as { type?: unknown }).type !== "string") {
        send(socket, { type: "error", message: "Некорректное сообщение" });
        return;
      }
      const message = parsed as ClientMessage;
      if (message.type === "create") {
        if (rooms.size >= 250) {
          send(socket, { type: "error", message: "Сервер занят. Попробуйте позже" });
          return;
        }
        if (socket.room) leave(socket);
        const id = makeCode();
        const settings = cleanSettings(message.settings);
        const now = performance.now();
        const room: Room = { id, players: [null, null], sim: new TableTennisSim(randomInt(1, 2 ** 30)), tick: 0, accumulator: 0, lastTickAt: now, lastActivityAt: Date.now(), rematchVotes: new Set() };
        const token = randomBytes(32).toString("base64url");
        room.players[0] = { socket, settings, token, disconnectedAt: null };
        rooms.set(id, room);
        socket.room = room;
        socket.side = 0;
        socket.settings = settings;
        send(socket, { type: "joined", roomId: id, side: 0, token });
        broadcastState(room);
        return;
      }
      if (message.type === "resume") {
        const room = rooms.get(typeof message.roomId === "string" ? message.roomId.toUpperCase() : "");
        const token = typeof message.token === "string" ? message.token : "";
        const side = room?.players.findIndex((player) => player !== null && tokensMatch(player.token, token)) ?? -1;
        const slot = room && side >= 0 ? room.players[side as Side] : null;
        if (!room || !slot || (!slot.socket && (slot.disconnectedAt === null
          || isReconnectExpired(slot.disconnectedAt, Date.now())))) {
          send(socket, { type: "error", message: "Сеанс больше недоступен. Создайте новую комнату" });
          return;
        }
        // A valid token may arrive before the old TCP connection is observed as
        // closed by the server. Let the newest authenticated socket take over.
        const previousSocket = slot.socket;
        if (previousSocket && previousSocket !== socket) {
          previousSocket.room = undefined;
          previousSocket.side = undefined;
          previousSocket.close(4002, "Session resumed elsewhere");
        }
        if (socket.room) leave(socket);
        slot.socket = socket;
        slot.disconnectedAt = null;
        room.lastActivityAt = Date.now();
        socket.room = room;
        socket.side = side as Side;
        socket.settings = slot.settings;
        send(socket, { type: "joined", roomId: room.id, side: socket.side, token: slot.token });
        room.sim.state.message = "Игрок вернулся. Продолжаем матч";
        broadcastState(room);
        return;
      }
      if (message.type === "join") {
        const room = rooms.get(typeof message.roomId === "string" ? message.roomId.toUpperCase() : "");
        if (!room) {
          send(socket, { type: "error", message: "Комната не найдена. Проверьте код" });
          return;
        }
        // Repeating join for the same socket is idempotent: do not reset the
        // match or evict the player from their own room.
        const currentSide = room.players.findIndex((player) => player?.socket === socket);
        if (currentSide >= 0) {
          socket.room = room;
          socket.side = currentSide as Side;
          send(socket, { type: "joined", roomId: room.id, side: socket.side, token: room.players[currentSide as Side]!.token });
          broadcastState(room);
          return;
        }
        const side: Side | null = !room.players[0] ? 0 : !room.players[1] ? 1 : null;
        if (side === null) {
          send(socket, { type: "error", message: "В комнате уже два игрока" });
          return;
        }
        // Validate the destination before leaving the current room. A typo or
        // full destination must never disconnect an otherwise active match.
        if (socket.room) leave(socket);
        const settings = cleanSettings(message.settings);
        const token = randomBytes(32).toString("base64url");
        room.players[side] = { socket, settings, token, disconnectedAt: null };
        room.lastActivityAt = Date.now();
        socket.room = room;
        socket.side = side;
        socket.settings = settings;
        send(socket, { type: "joined", roomId: room.id, side, token });
        if (room.players[0]?.socket && room.players[1]?.socket) room.sim.startMatch();
        broadcastState(room);
        return;
      }
      if (message.type === "input") {
        const now = Date.now();
        // Cap per-client input to a sensible 100 Hz; clients normally send 30 Hz.
        if (socket.room && socket.side !== undefined && isValidPaddleInput(message.input) && now - (socket.lastInputAt ?? 0) >= 10) {
          socket.lastInputAt = now;
          socket.room.lastActivityAt = now;
          socket.room.sim.setInput(socket.side, message.input);
        }
        return;
      }
      if (message.type === "rematch") {
        const room = socket.room;
        if (room && socket.side !== undefined && room.sim.state.phase === "gameover") {
          room.rematchVotes.add(socket.side);
          if (room.rematchVotes.size === 2) {
            room.rematchVotes.clear();
            room.sim.startMatch();
          } else {
            room.sim.state.message = "Ожидаем подтверждения реванша от соперника";
          }
          broadcastState(room);
        }
        return;
      }
      if (message.type === "ping") {
        if (socket.room) socket.room.lastActivityAt = Date.now();
        send(socket, { type: "pong", at: Number(message.at) || 0 });
        return;
      }
      send(socket, { type: "error", message: "Неизвестный тип сообщения" });
    });
    socket.on("close", () => leave(socket, true));
    socket.on("error", () => leave(socket, true));
  });

  const timer = setInterval(() => {
    const now = performance.now();
    for (const room of rooms.values()) {
      let expiredSeat = false;
      for (let side = 0 as Side; side <= 1; side = (side + 1) as Side) {
        const slot = room.players[side];
        if (slot && !slot.socket && slot.disconnectedAt !== null
          && isReconnectExpired(slot.disconnectedAt, Date.now())) {
          room.players[side] = null;
          expiredSeat = true;
        }
      }
      if (expiredSeat) {
        if (!room.players[0] && !room.players[1]) {
          rooms.delete(room.id);
          continue;
        }
        resetForWaitingPlayer(room);
      }
      const connectedPlayers = Number(Boolean(room.players[0]?.socket)) + Number(Boolean(room.players[1]?.socket));
      if (isWaitingRoomExpired(connectedPlayers, room.lastActivityAt, Date.now())) {
        for (const player of room.players) {
          if (player?.socket) {
            send(player.socket, { type: "error", message: "Комната закрыта из-за длительного бездействия" });
            player.socket.room = undefined;
            player.socket.side = undefined;
          }
        }
        rooms.delete(room.id);
        continue;
      }
      if (!room.players[0]?.socket || !room.players[1]?.socket) {
        room.lastTickAt = now;
        room.accumulator = 0;
        continue;
      }
      // Keep simulation time independent of Node's setInterval jitter. The
      // catch-up cap avoids a spiral of death after a brief server stall.
      const elapsed = Math.min(0.1, Math.max(0, (now - room.lastTickAt) / 1000));
      room.lastTickAt = now;
      room.accumulator = Math.min(0.1, room.accumulator + elapsed);
      let steps = 0;
      while (room.accumulator >= 1 / 120 && steps < 12) {
        room.sim.step(1 / 120);
        room.accumulator -= 1 / 120;
        room.tick += 1;
        steps += 1;
      }
      // State snapshots at 30 Hz; clients interpolate between authoritative states.
      if (room.tick > 0 && room.tick % 4 < steps) broadcastState(room);
    }
  }, 1000 / 60);
  server.on("close", () => {
    clearInterval(timer);
    wss.close();
  });
}
