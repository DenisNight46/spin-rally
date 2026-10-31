import { randomInt } from "node:crypto";
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
  socket: ClientSocket;
  settings: PlayerSettings;
}

interface Room {
  id: string;
  players: [PlayerSlot | null, PlayerSlot | null];
  sim: TableTennisSim;
  tick: number;
  accumulator: number;
  lastTickAt: number;
}

const rooms = new Map<string, Room>();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
    peerConnected: Boolean(room.players[0] && room.players[1]),
  };
  for (const player of room.players) if (player) send(player.socket, message);
}

function leave(socket: ClientSocket): void {
  const room = socket.room;
  if (!room || socket.side === undefined) return;
  room.players[socket.side] = null;
  socket.room = undefined;
  if (!room.players[0] && !room.players[1]) {
    rooms.delete(room.id);
    return;
  }
  room.sim = new TableTennisSim(randomInt(1, 2 ** 30));
  room.sim.state.message = "Соперник отключился. Ожидание нового игрока";
  broadcastState(room);
}

function validInput(input: PaddleInput): boolean {
  return input && typeof input === "object" && ["x", "y", "z"].every((key) => {
    const value = input[key as "x" | "y" | "z"];
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 3;
  });
}

export function attachRealtime(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (socket: ClientSocket) => {
    socket.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(socket, { type: "error", message: "Некорректное сообщение" });
        return;
      }
      if (message.type === "create") {
        if (socket.room) leave(socket);
        const id = makeCode();
        if (rooms.size > 250) {
          send(socket, { type: "error", message: "Сервер занят. Попробуйте позже" });
          return;
        }
        const settings = cleanSettings(message.settings);
        const now = performance.now();
        const room: Room = { id, players: [null, null], sim: new TableTennisSim(randomInt(1, 2 ** 30)), tick: 0, accumulator: 0, lastTickAt: now };
        room.players[0] = { socket, settings };
        rooms.set(id, room);
        socket.room = room;
        socket.side = 0;
        socket.settings = settings;
        send(socket, { type: "joined", roomId: id, side: 0 });
        broadcastState(room);
        return;
      }
      if (message.type === "join") {
        if (socket.room) leave(socket);
        const room = rooms.get(String(message.roomId).toUpperCase());
        if (!room) {
          send(socket, { type: "error", message: "Комната не найдена. Проверьте код" });
          return;
        }
        const side: Side | null = !room.players[0] ? 0 : !room.players[1] ? 1 : null;
        if (side === null) {
          send(socket, { type: "error", message: "В комнате уже два игрока" });
          return;
        }
        const settings = cleanSettings(message.settings);
        room.players[side] = { socket, settings };
        socket.room = room;
        socket.side = side;
        socket.settings = settings;
        send(socket, { type: "joined", roomId: room.id, side });
        if (room.players[0] && room.players[1]) room.sim.startMatch();
        broadcastState(room);
        return;
      }
      if (message.type === "input") {
        const now = Date.now();
        // Cap per-client input to a sensible 100 Hz; clients normally send 30 Hz.
        if (socket.room && socket.side !== undefined && validInput(message.input) && now - (socket.lastInputAt ?? 0) >= 10) {
          socket.lastInputAt = now;
          socket.room.sim.setInput(socket.side, message.input);
        }
        return;
      }
      if (message.type === "rematch") {
        if (socket.room?.sim.state.phase === "gameover") socket.room.sim.startMatch();
        return;
      }
      if (message.type === "ping") send(socket, { type: "pong", at: Number(message.at) || 0 });
    });
    socket.on("close", () => leave(socket));
    socket.on("error", () => leave(socket));
  });

  const timer = setInterval(() => {
    const now = performance.now();
    for (const room of rooms.values()) {
      if (!room.players[0] || !room.players[1]) {
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
