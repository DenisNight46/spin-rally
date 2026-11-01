import type { ClientMessage, ServerMessage } from "@contracts/network";
import type { MatchState, PaddleInput, PlayerSettings } from "@contracts/sim";

interface Snapshot { at: number; state: MatchState }
const INTERPOLATION_DELAY = 95;

import { interpolateMatchStates } from "./interpolation";
import {
  getReconnectDelay,
  isHeartbeatTimedOut,
  isReconnectWindowOpen,
  NETWORK_CONNECT_TIMEOUT_MS,
  NETWORK_HEARTBEAT_INTERVAL_MS,
  NETWORK_RECONNECT_WINDOW_MS,
} from "./network-health";

function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

export class NetworkClient {
  private socket: WebSocket | null = null;
  private pingTimer = 0;
  private connectTimer = 0;
  private reconnectTimer = 0;
  private lastPongAt = 0;
  private snapshots: Snapshot[] = [];
  private action: "create" | "join" = "create";
  private settings: PlayerSettings | null = null;
  private roomId = "";
  private sessionToken = "";
  private reconnectStartedAt = 0;
  private reconnectAttempt = 0;
  private disposed = false;
  ping = 0;
  onMessage: (message: ServerMessage) => void = () => {};
  onStatus: (status: "connecting" | "connected" | "disconnected") => void = () => {};

  connect(action: "create" | "join", settings: PlayerSettings, roomId?: string): void {
    this.closeSocket();
    this.disposed = false;
    this.snapshots = [];
    this.action = action;
    this.settings = settings;
    this.roomId = roomId ?? "";
    this.sessionToken = "";
    this.reconnectStartedAt = 0;
    this.reconnectAttempt = 0;
    this.openSocket(false);
  }

  private openSocket(reconnecting: boolean): void {
    if (this.disposed || !this.settings) return;
    this.onStatus("connecting");
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket = socket;
    this.connectTimer = window.setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }, NETWORK_CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      window.clearTimeout(this.connectTimer);
      this.connectTimer = 0;
      this.lastPongAt = performance.now();
      this.onStatus("connected");
      if (reconnecting && this.sessionToken) {
        this.send({ type: "resume", roomId: this.roomId, token: this.sessionToken });
      } else {
        this.send(this.action === "create"
          ? { type: "create", settings: this.settings! }
          : { type: "join", settings: this.settings!, roomId: this.roomId });
      }
      this.pingTimer = window.setInterval(() => {
        const now = performance.now();
        if (isHeartbeatTimedOut(this.lastPongAt, now)) {
          window.clearInterval(this.pingTimer);
          this.pingTimer = 0;
          socket.close(4000, "Heartbeat timeout");
          return;
        }
        this.send({ type: "ping", at: now });
      }, NETWORK_HEARTBEAT_INTERVAL_MS);
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "pong") {
          this.lastPongAt = performance.now();
          this.ping = Math.max(0, Math.round(this.lastPongAt - message.at));
        }
        if (message.type === "joined") {
          this.roomId = message.roomId;
          this.sessionToken = message.token;
          this.reconnectStartedAt = 0;
          this.reconnectAttempt = 0;
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = 0;
        }
        if (message.type === "error" && reconnecting && this.sessionToken) {
          // An explicit resume rejection means the server no longer recognizes this seat.
          this.sessionToken = "";
          this.reconnectStartedAt = 0;
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = 0;
          socket.close(4001, "Resume rejected");
        }
        if (message.type === "state") {
          this.snapshots.push({ at: performance.now(), state: cloneState(message.state) });
          if (this.snapshots.length > 12) this.snapshots.shift();
        }
        this.onMessage(message);
      } catch {
        // Ignore malformed packets; the next authoritative snapshot repairs the view.
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      window.clearInterval(this.pingTimer);
      window.clearTimeout(this.connectTimer);
      this.pingTimer = 0;
      this.connectTimer = 0;
      this.onStatus("disconnected");
      if (this.sessionToken && !this.disposed) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.onStatus("disconnected");
    });
  }

  private scheduleReconnect(): void {
    if (!this.sessionToken || this.disposed) return;
    const now = performance.now();
    if (!this.reconnectStartedAt) this.reconnectStartedAt = now;
    if (!isReconnectWindowOpen(this.reconnectStartedAt, now)) {
      this.sessionToken = "";
      return;
    }
    window.clearTimeout(this.reconnectTimer);
    const delay = getReconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      if (!this.disposed && this.sessionToken) this.openSocket(true);
    }, Math.min(delay, Math.max(0, NETWORK_RECONNECT_WINDOW_MS - (now - this.reconnectStartedAt))));
  }

  /** Render-only interpolation behind real time; gameplay decisions remain server authoritative. */
  getInterpolatedState(now = performance.now()): MatchState | null {
    if (!this.snapshots.length) return null;
    const target = now - INTERPOLATION_DELAY;
    let a = this.snapshots[0], b = this.snapshots[this.snapshots.length - 1];
    for (let i = 1; i < this.snapshots.length; i += 1) {
      if (this.snapshots[i].at >= target) {
        a = this.snapshots[i - 1];
        b = this.snapshots[i];
        break;
      }
    }
    if (a === b || b.at <= a.at) return cloneState(b.state);
    const t = Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at)));
    return interpolateMatchStates(a.state, b.state, t);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  sendInput(input: PaddleInput): void { this.send({ type: "input", input }); }

  private closeSocket(): void {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.connectTimer);
    window.clearTimeout(this.reconnectTimer);
    this.pingTimer = 0;
    this.connectTimer = 0;
    this.reconnectTimer = 0;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  dispose(): void {
    this.disposed = true;
    this.closeSocket();
    this.snapshots = [];
    this.sessionToken = "";
    this.onStatus = () => {};
    this.onMessage = () => {};
  }
}
