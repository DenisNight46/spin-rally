import type { MatchState, PaddleInput, PlayerSettings, Side } from "./sim";

export type ClientMessage =
  | { type: "create"; settings: PlayerSettings }
  | { type: "join"; roomId: string; settings: PlayerSettings }
  | { type: "input"; input: PaddleInput }
  | { type: "rematch" }
  | { type: "ping"; at: number };

export type ServerMessage =
  | { type: "joined"; roomId: string; side: Side }
  | { type: "state"; state: MatchState; players: [PlayerSettings, PlayerSettings]; peerConnected: boolean }
  | { type: "error"; message: string }
  | { type: "pong"; at: number };
