import type { Difficulty } from "./ai";
import type { MatchState, PlayerSettings, Side } from "@contracts/sim";

export type GameMode = "title" | "single" | "online";
export type NetworkStatus = "offline" | "connecting" | "connected" | "disconnected";

export interface GameUIState {
  mode: GameMode;
  state: MatchState;
  ownSide: Side;
  players: [PlayerSettings, PlayerSettings];
  settings: PlayerSettings;
  difficulty: Difficulty;
  roomId: string;
  peerConnected: boolean;
  networkStatus: NetworkStatus;
  networkError: string;
  ping: number;
  paused: boolean;
  muted: boolean;
}

export interface GameController {
  startSingle: (difficulty: Difficulty) => void;
  showTitle: () => void;
  togglePause: () => void;
  createRoom: () => void;
  joinRoom: (roomId: string) => void;
  rematch: () => void;
  serve: () => void;
  updateSettings: (settings: PlayerSettings) => void;
  toggleMute: () => void;
}
