import { DEFAULT_INPUT, type PaddleInput, type TableTennisSim } from "@contracts/sim";
import { predictRacketIntercept } from "./trajectory";

export type Difficulty = "easy" | "normal" | "hard";

const LEVELS = {
  easy: { reaction: 0.055, speed: 1.08, error: 0.055, anticipation: 0.18 },
  normal: { reaction: 0.032, speed: 1.22, error: 0.022, anticipation: 0.24 },
  hard: { reaction: 0.018, speed: 1.38, error: 0.006, anticipation: 0.34 },
} as const;

const AI_RACKET_Z = -1.48;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export interface AIShotPlan {
  offset: number;
  height: number;
  predictedOpponentX: number;
}

/** Aim away from where the opponent is moving, not merely where they stood. */
export function planAIShot(
  difficulty: Difficulty,
  rallyHits: number,
  opponentX: number,
  opponentVelocityX: number,
  interceptTime: number,
  variation: number,
): AIShotPlan {
  const leadTime = clamp(interceptTime * 0.7, 0.08, 0.28);
  const predictedOpponentX = clamp(opponentX + opponentVelocityX * leadTime, -0.98, 0.98);
  const direction = difficulty === "easy"
    ? 0
    : difficulty === "normal"
      ? (rallyHits % 2 === 0 ? 1 : -1)
      : Math.abs(predictedOpponentX) < 0.16
        ? (variation >= 0 ? 1 : -1)
        : predictedOpponentX > 0 ? -1 : 1;
  const precision = difficulty === "easy" ? 0 : difficulty === "normal" ? 0.04 : 0.085;
  return {
    offset: direction * precision * (0.72 + Math.abs(variation) * 0.28),
    height: (rallyHits % 2 === 0 ? 1 : -1) *
      (difficulty === "easy" ? 0 : difficulty === "normal" ? 0.018 : 0.032),
    predictedOpponentX,
  };
}

export function predictAIIntercept(sim: TableTennisSim): { x: number; y: number; time: number } | null {
  return predictRacketIntercept(sim.state, 1);
}

export class TableTennisAI {
  private think = 0;
  private clock = 0;
  private serveDelay = 0;
  private serveIndex = 0;
  private serveTargetX: number | null = null;
  private plannedRally = -1;
  private shotOffset = 0;
  private shotHeight = 0;
  private input: PaddleInput = { ...DEFAULT_INPUT, z: AI_RACKET_Z };

  constructor(private difficulty: Difficulty = "normal") {}

  reset(): void {
    this.think = 0;
    this.serveDelay = 0;
    this.serveIndex = 0;
    this.serveTargetX = null;
    this.plannedRally = -1;
    this.shotOffset = 0;
    this.shotHeight = 0;
    this.input = { ...DEFAULT_INPUT, z: AI_RACKET_Z };
  }

  update(sim: TableTennisSim, dt: number): void {
    const level = LEVELS[this.difficulty];
    const state = sim.state;
    this.clock += dt;
    this.think -= dt;
    this.serveDelay += dt;
    this.input.serve = false;
    this.input.power = false;
    this.input.slice = false;

    if (state.phase === "serve") {
      if (state.server === 1 && this.serveTargetX === null) {
        // Rotate through distinct legal service placements instead of feeding
        // the same predictable ball every point.
        const patterns = [-0.48, 0.48, -0.16, 0.18, 0.02];
        const spread = this.difficulty === "easy" ? 0.72 : this.difficulty === "normal" ? 0.88 : 1;
        this.serveTargetX = patterns[this.serveIndex % patterns.length] * spread;
        this.serveIndex += 1;
      }
      const serveX = state.server === 1 ? this.serveTargetX ?? 0 : 0;
      this.input.x += (serveX - this.input.x) * Math.min(1, dt * 4);
      this.input.y += (1.17 - this.input.y) * Math.min(1, dt * 4);
      this.input.z = AI_RACKET_Z;
      if (state.server === 1 && this.serveDelay > 0.72) {
        this.input.serve = true;
        this.serveDelay = 0;
        this.serveTargetX = null;
      }
      sim.setInput(1, this.input);
      return;
    }

    if (state.phase !== "rally") {
      this.serveDelay = 0;
      this.serveTargetX = null;
      this.input.x += (0 - this.input.x) * Math.min(1, dt * 2.5);
      this.input.y += (1.17 - this.input.y) * Math.min(1, dt * 2.5);
      this.input.z = AI_RACKET_Z;
      sim.setInput(1, this.input);
      return;
    }

    const intercept = predictAIIntercept(sim);
    if (intercept && this.think <= 0) {
      this.think = level.reaction;
      // Choose one shot plan per incoming ball. The target is deliberately
      // offset only a few centimetres: the blade still has to physically
      // overlap the ball, while its lateral/upward movement shapes the return.
      if (this.plannedRally !== state.rallyHits) {
        this.plannedRally = state.rallyHits;
        const opponent = state.paddles[0];
        const variation = Math.sin(state.rallyHits * 12.9898 + this.clock * 2.17);
        // Plan against the opponent's likely position at contact, not only the
        // position from the previous snapshot. This makes the expert punish
        // committed lateral movement while the lower levels remain readable.
        const plan = planAIShot(
          this.difficulty,
          state.rallyHits,
          opponent.x,
          opponent.vx,
          intercept.time,
          variation,
        );
        this.shotOffset = plan.offset;
        // Racket-head velocity creates spin through the shared collision model.
        this.shotHeight = plan.height;
      }
      const error = Math.sin(this.clock * 7.13 + state.rallyHits * 2.7) * level.error;
      const anticipation = clamp(level.anticipation / Math.max(intercept.time, 0.04), 0.12, 1);
      const tracking = clamp(dt * 60 * level.speed * (0.75 + anticipation), 0, 1);
      const targetX = clamp(intercept.x + this.shotOffset + error, -0.94, 0.94);
      const targetY = clamp(intercept.y + this.shotHeight, 0.84, 1.70);
      this.input.x += (targetX - this.input.x) * tracking;
      this.input.y += (targetY - this.input.y) * tracking;
      this.input.z = AI_RACKET_Z;
    } else if (!intercept && state.ball.v.z >= 0) {
      this.input.x += (0 - this.input.x) * Math.min(1, dt * 2.2 * level.speed);
      this.input.y += (1.17 - this.input.y) * Math.min(1, dt * 2.2);
      this.input.z = AI_RACKET_Z;
    }

    sim.setInput(1, this.input);
  }
}
