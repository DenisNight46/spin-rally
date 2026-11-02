import { GameLoop } from "./engine";
import { Input } from "./input";
import { AudioSystem } from "./audio";
import { SceneView } from "./scene";
import { TableTennisAI, type Difficulty } from "./ai";
import { NetworkClient } from "./network";
import { accuracyRecord, storage, trainingRecord } from "./storage";
import { getTrainingProgress, isAccuracyTargetHit } from "./training";
import { getContactAssistWeight, predictRacketIntercept } from "./trajectory";
import type { GameController, GameMode, GameUIState, NetworkStatus } from "./types";
import type { ServerMessage } from "@contracts/network";
import { DEFAULT_SETTINGS, TableTennisSim, type MatchState, type PaddleInput, type PlayerSettings, type Side } from "@contracts/sim";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
    __gameStats?: () => { calls: number; triangles: number };
    __gameVerifyMatch?: () => { phase: string; winner: Side | null; games: [number, number] };
  }
}

let session: { dispose: () => void } | null = null;


function cleanSettings(value: PlayerSettings): PlayerSettings {
  const color = (input: unknown, fallback: string) => typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback;
  return {
    name: typeof value?.name === "string" && value.name.trim() ? value.name.trim().slice(0, 16) : DEFAULT_SETTINGS.name,
    kit: color(value?.kit, DEFAULT_SETTINGS.kit),
    paddle: color(value?.paddle, DEFAULT_SETTINGS.paddle),
    ball: color(value?.ball, DEFAULT_SETTINGS.ball),
  };
}

class SpinRallyGame {
  private scene: SceneView;
  private input: Input;
  private audio = new AudioSystem();
  private loop: GameLoop;
  private sim = new TableTennisSim();
  private ai = new TableTennisAI("normal");
  private network: NetworkClient | null = null;
  private netState: MatchState | null = null;
  private mode: GameMode = "title";
  private ownSide: Side = 0;
  private settings = cleanSettings(storage.get<PlayerSettings>("spinRally.settings", DEFAULT_SETTINGS));
  private players: [PlayerSettings, PlayerSettings] = [this.settings, { ...DEFAULT_SETTINGS, name: "Соперник", kit: "#ef6a67" }];
  private difficulty: Difficulty = "normal";
  private roomId = "";
  private peerConnected = false;
  private networkStatus: NetworkStatus = "offline";
  private networkError = "";
  private paused = false;
  private lastEvent = 0;
  private lastUi = 0;
  private sendClock = 0;
  private humanTarget = { x: 0, y: 1.17, z: 1.48 };
  private touchDragAnchor: { x: number; y: number } | null = null;
  private renderLast = performance.now();
  private disposed = false;
  private trainingBest = trainingRecord.get();
  private accuracyScore = 0;
  private accuracyBest = accuracyRecord.get();
  private lastAccuracyEvent = 0;

  constructor(private canvas: HTMLCanvasElement, private onUI: (state: GameUIState) => void) {
    this.scene = new SceneView(canvas);
    this.input = new Input(canvas);
    this.sim.state.message = "Выберите режим игры";
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: () => this.render() });
    window.__gameProbe = () => {
      const p = this.currentState().paddles[this.ownSide];
      return { x: p.x, y: p.y, z: p.z };
    };
    window.__gameStats = () => this.scene.getStats();
    if (new URLSearchParams(location.search).has("verify")) {
      window.__gameVerifyMatch = () => {
        let steps = 0;
        while (this.mode === "single" && this.sim.state.phase !== "gameover" && steps < 30000) {
          this.ai.update(this.sim, 1 / 60);
          this.sim.setInput(0, { x: -0.98, y: 1.7, z: 1.72, power: false, slice: false, serve: this.sim.state.phase === "serve" && this.sim.state.server === 0 });
          this.sim.step(1 / 120);
          this.sim.step(1 / 120);
          steps += 2;
        }
        this.notify();
        return { phase: this.sim.state.phase, winner: this.sim.state.winner, games: this.sim.state.games };
      };
    }
    this.notify();
    this.loop.start();
    const inviteCode = new URLSearchParams(location.search).get("room");
    if (inviteCode && /^[A-HJ-NP-Z2-9]{6}$/i.test(inviteCode)) {
      queueMicrotask(() => this.openRoom("join", inviteCode.toUpperCase()));
    }
  }

  controller(): GameController {
    return {
      startSingle: (difficulty) => this.startSingle(difficulty),
      startTraining: () => this.startTraining(),
      startAccuracy: () => this.startAccuracy(),
      showTitle: () => this.showTitle(),
      togglePause: () => this.togglePause(),
      createRoom: () => this.openRoom("create"),
      joinRoom: (roomId) => this.openRoom("join", roomId),
      rematch: () => this.rematch(),
      updateSettings: (settings) => this.updateSettings(settings),
      toggleMute: () => this.toggleMute(),
    };
  }

  private currentState(): MatchState {
    return this.mode === "online" && this.netState ? this.netState : this.sim.state;
  }

  private startSingle(difficulty: Difficulty): void {
    this.closeNetwork();
    this.difficulty = difficulty;
    this.ai = new TableTennisAI(difficulty);
    this.scene.setAccuracyMode(false);
    this.sim = new TableTennisSim(this.seed());
    this.ai.reset();
    this.mode = "single";
    this.ownSide = 0;
    this.paused = false;
    this.players = [this.settings, { ...DEFAULT_SETTINGS, name: difficulty === "easy" ? "Робот · Новичок" : difficulty === "hard" ? "Робот · Профи" : "Робот · Любитель", kit: "#ef6a67", paddle: "#26313d" }];
    this.humanTarget = { x: 0, y: 1.17, z: 1.48 };
    this.touchDragAnchor = null;
    this.lastEvent = 0;
    this.sim.startMatch();
    this.scene.setTitleMode(false);
    this.audio.startMusic();
    this.notify();
  }

  private startAccuracy(): void {
    this.startSingle("easy");
    this.mode = "accuracy";
    this.accuracyScore = 0;
    this.lastAccuracyEvent = this.sim.state.eventId;
    this.scene.setAccuracyMode(true);
    this.sim.state.message = "Попади в светящуюся зону на дальней половине стола";
    this.notify();
  }

  private startTraining(): void {
    this.startSingle("easy");
    this.mode = "training";
    this.scene.setAccuracyMode(false);
    this.players[1] = { ...this.players[1], name: "Тренировочный робот" };
    this.sim.state.message = "Цель: продержи мяч в игре 10 ударов подряд";
    this.notify();
  }

  private showTitle(): void {
    this.closeNetwork();
    this.mode = "title";
    this.scene.setAccuracyMode(false);
    this.paused = false;
    this.netState = null;
    this.roomId = "";
    this.networkError = "";
    history.replaceState(null, "", location.pathname);
    this.scene.setTitleMode(true);
    this.audio.stopMusic();
    this.input.reset();
    this.notify();
  }

  private togglePause(): void {
    if (this.mode === "title" || this.currentState().phase === "gameover") return;
    if (this.mode === "online") return;
    this.paused = !this.paused;
    this.input.reset();
    this.notify();
  }

  private openRoom(action: "create" | "join", code?: string): void {
    if (action === "join" && !code?.trim()) {
      this.networkError = "Введите код комнаты";
      this.notify();
      return;
    }
    this.closeNetwork();
    this.mode = "online";
    this.ownSide = action === "create" ? 0 : 1;
    this.paused = false;
    this.netState = new TableTennisSim().state;
    this.netState.message = action === "create" ? "Создаём комнату…" : "Подключаемся к комнате…";
    this.players = [this.settings, { ...DEFAULT_SETTINGS, name: "Соперник" }];
    this.roomId = code?.toUpperCase() ?? "";
    this.peerConnected = false;
    this.networkError = "";
    this.lastEvent = 0;
    this.humanTarget = { x: 0, y: 1.17, z: this.ownSide === 0 ? 0.92 : -0.92 };
    this.scene.setTitleMode(false);
    this.audio.startMusic();
    const network = new NetworkClient();
    this.network = network;
    network.onStatus = (status) => {
      if (this.network !== network) return;
      this.networkStatus = status;
      this.notify();
    };
    network.onMessage = (message) => this.onNetworkMessage(network, message);
    network.connect(action, this.settings, code?.trim().toUpperCase());
    this.notify();
  }

  private onNetworkMessage(network: NetworkClient, message: ServerMessage): void {
    if (this.network !== network) return;
    if (message.type === "joined") {
      this.roomId = message.roomId;
      this.ownSide = message.side;
      this.humanTarget.z = this.ownSide === 0 ? 1.48 : -1.48;
    } else if (message.type === "state") {
      this.netState = message.state;
      this.players = message.players;
      this.players[this.ownSide] = this.settings;
      this.peerConnected = message.peerConnected;
    } else if (message.type === "error") {
      this.networkError = message.message;
    }
    this.notify();
  }

  private rematch(): void {
    if (this.mode === "single") {
      this.startSingle(this.difficulty);
    } else if (this.mode === "accuracy") {
      this.startAccuracy();
    } else if (this.mode === "online") {
      this.network?.send({ type: "rematch" });
    }
  }

  private updateSettings(settings: PlayerSettings): void {
    this.settings = cleanSettings(settings);
    storage.set("spinRally.settings", this.settings);
    this.players[this.ownSide] = this.settings;
    this.notify();
  }

  private toggleMute(): void {
    this.audio.toggleMute();
    this.notify();
  }

  private closeNetwork(): void {
    this.network?.dispose();
    this.network = null;
    this.networkStatus = "offline";
    this.peerConnected = false;
  }

  private seed(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] || 2026;
  }

  private humanInput(dt: number): PaddleInput {
    const state = this.currentState();
    const sign = this.ownSide === 0 ? 1 : -1;
    const orientation = this.ownSide === 0 ? 1 : -1;
    // Touch uses relative dragging: the racket starts where it already is and
    // follows the finger's movement. Mouse keeps absolute desktop positioning.
    if (this.input.pointerType === "touch") {
      // Preserve the actual pointer-down position separately from the latest
      // sample: a fast swipe can begin, move and end between two game frames.
      if (this.input.consumePointerStart()) {
        this.touchDragAnchor = this.scene.pointerToRacket(this.input.pointerStartX, this.input.pointerStartY, this.ownSide);
      }
      if (this.input.pointerFresh) {
        const projected = this.scene.pointerToRacket(this.input.pointerX, this.input.pointerY, this.ownSide);
        if (projected && this.touchDragAnchor) {
          this.humanTarget.x += (projected.x - this.touchDragAnchor.x) * 0.9;
          this.humanTarget.y += (projected.y - this.touchDragAnchor.y) * 0.75;
        }
        this.touchDragAnchor = projected;
      }
      // Apply the final pointer sample before dropping the drag anchor on release.
      if (!this.input.pointerActive) this.touchDragAnchor = null;
      this.input.pointerFresh = false;
    } else {
      this.input.consumePointerStart();
      if (this.input.pointerFresh) {
        const projected = this.scene.pointerToRacket(this.input.pointerX, this.input.pointerY, this.ownSide);
        if (projected) {
          this.humanTarget.x = projected.x;
          this.humanTarget.y = projected.y;
        }
        this.touchDragAnchor = null;
        this.input.pointerFresh = false;
      }
    }
    if (this.input.x !== 0) this.humanTarget.x += this.input.x * dt * 1.85 * orientation;
    if (this.input.y !== 0) this.humanTarget.y += this.input.y * dt * 1.45;

    // Arcade reach: when the ball has crossed onto our half, let the racket
    // move forward to meet short balls near the net instead of being trapped
    // on the baseline. The player still controls lateral and vertical aim.
    const ballDepth = state.ball.p.z * sign;
    const reachPlane = state.phase === "rally" && state.ball.v.z * sign > 0.15 && ballDepth > 0
      ? Math.max(0.72, Math.min(1.48, ballDepth + 0.48))
      : 1.48;

    // Soft contact assistance works on mouse and touch. It only nudges a
    // nearby target toward a legal contact point; touch receives a lower cap
    // so the racket remains firmly under the player's finger.
    if (state.phase === "rally" && state.ball.v.z * sign > 0.15) {
      const intercept = predictRacketIntercept(state, this.ownSide, 0.52, true, reachPlane, { z: state.paddles[this.ownSide].z, vz: state.paddles[this.ownSide].vz, targetZ: sign * reachPlane });
      if (intercept) {
        const distance = Math.hypot(intercept.x - this.humanTarget.x, intercept.y - this.humanTarget.y);
        const assist = getContactAssistWeight(distance, intercept.time, this.input.pointerType === "touch");
        this.humanTarget.x += (intercept.x - this.humanTarget.x) * assist;
        this.humanTarget.y += (intercept.y - this.humanTarget.y) * assist;
      }
    }

    this.humanTarget.x = Math.max(-0.98, Math.min(0.98, this.humanTarget.x));
    this.humanTarget.y = Math.max(0.66, Math.min(1.7, this.humanTarget.y));
    // Depth is assisted automatically for short balls; normal rallies stay
    // near the baseline. This is intentionally forgiving, not a third axis
    // the player has to micromanage on a phone screen.
    this.humanTarget.z = sign * reachPlane;
    return {
      x: this.humanTarget.x,
      y: this.humanTarget.y,
      z: this.humanTarget.z,
      power: false,
      slice: false,
      serve: false,
    };
  }

  private update(dt: number): void {
    if (this.disposed) return;
    if (this.input.consume("KeyM")) this.toggleMute();
    if (this.mode === "title") {
      if (this.input.consume("Space")) this.startSingle("easy");
      return;
    }
    if (this.input.consume("Escape") || this.input.consume("KeyP")) this.togglePause();
    if (this.paused) return;
    const human = this.humanInput(dt);
    if (this.mode === "single" || this.mode === "training" || this.mode === "accuracy") {
      this.sim.setInput(0, human);
      this.ai.update(this.sim, dt);
      this.sim.step(1 / 120);
      this.trackAccuracyEvent();
      this.sim.step(1 / 120);
      this.trackAccuracyEvent();
      if (this.mode === "training") {
        const progress = getTrainingProgress(this.sim.state.rallyHits, this.trainingBest);
        if (progress.best > this.trainingBest) {
          this.trainingBest = progress.best;
          trainingRecord.set(this.trainingBest);
        }
      }
    } else if (this.mode === "online") {
      this.sendClock += dt;
      if (this.sendClock >= 1 / 30) {
        this.sendClock = 0;
        this.network?.sendInput(human);
      }
    }
  }

  private trackAccuracyEvent(): void {
    if (this.mode !== "accuracy") return;
    const event = this.sim.state.event;
    if (!event || event.type !== "bounce" || this.sim.state.eventId === this.lastAccuracyEvent) return;
    this.lastAccuracyEvent = this.sim.state.eventId;
    if (event.side !== 0 || !event.p || event.p.z >= 0) return;
    if (isAccuracyTargetHit(event.p)) {
      this.accuracyScore += 1;
      if (this.accuracyScore > this.accuracyBest) {
        this.accuracyBest = this.accuracyScore;
        accuracyRecord.set(this.accuracyBest);
      }
      this.sim.state.message = "Точно в цель! Отличный удар";
    } else {
      this.sim.state.message = "Мимо цели — меняй направление удара";
    }
  }

  private processEvent(state: MatchState): void {
    if (!state.event || state.eventId === this.lastEvent) return;
    this.lastEvent = state.eventId;
    this.scene.handleEvent(state.event, state.eventId);
    const type = state.event.type;
    if (type === "hit") this.audio.sfx("hit");
    else if (type === "bounce") this.audio.sfx("bounce");
    else if (type === "net") this.audio.sfx("net");
    else if (type === "serve") this.audio.sfx("serve");
    else if (type === "point") this.audio.sfx("score");
    else if (type === "game") this.audio.sfx(state.winner === this.ownSide ? "win" : "lose");
  }

  private render(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.renderLast) / 1000);
    this.renderLast = now;
    if (this.mode === "title") {
      this.scene.updateIdle(dt);
    } else {
      const state = this.currentState();
      this.processEvent(state);
      const renderState = this.mode === "online" ? (this.network?.getInterpolatedState() ?? state) : state;
      if (this.mode === "online") renderState.paddles[this.ownSide] = { ...state.paddles[this.ownSide] };
      this.scene.update(renderState, this.ownSide, this.players, dt, this.mode === "online");
      if (now - this.lastUi > 100) {
        this.lastUi = now;
        this.notify();
      }
    }
    this.scene.render();
    window.__GAME_READY__ = true;
  }

  private notify(): void {
    this.onUI({
      mode: this.mode,
      state: this.currentState(),
      ownSide: this.ownSide,
      players: this.players,
      settings: this.settings,
      difficulty: this.difficulty,
      roomId: this.roomId,
      peerConnected: this.peerConnected,
      networkStatus: this.networkStatus,
      networkError: this.networkError,
      ping: this.network?.ping ?? 0,
      paused: this.paused,
      muted: this.audio.muted,
      trainingBest: this.trainingBest,
      accuracyScore: this.accuracyScore,
      accuracyBest: this.accuracyBest,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.closeNetwork();
    this.input.dispose();
    this.audio.dispose();
    this.scene.dispose();
    delete window.__gameProbe;
    delete window.__gameStats;
    delete window.__gameVerifyMatch;
    window.__GAME_READY__ = false;
  }
}

export function startGame(canvas: HTMLCanvasElement, onUI: (state: GameUIState) => void = () => {}): GameController {
  stopGame();
  const game = new SpinRallyGame(canvas, onUI);
  session = game;
  return game.controller();
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}
