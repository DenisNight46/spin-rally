import { DEFAULT_INPUT, TABLE, type PaddleInput, type TableTennisSim, type Vec3 } from "@contracts/sim";

export type Difficulty = "easy" | "normal" | "hard";

const LEVELS = {
  easy: { reaction: 0.075, speed: 0.78, error: 0.055, anticipation: 0.10 },
  normal: { reaction: 0.040, speed: 0.95, error: 0.022, anticipation: 0.18 },
  hard: { reaction: 0.018, speed: 1.10, error: 0.006, anticipation: 0.30 },
} as const;

const AI_RACKET_Z = -1.48;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function predictIntercept(sim: TableTennisSim): { x: number; y: number; time: number } | null {
  const ball = sim.state.ball;
  const planeZ = AI_RACKET_Z;
  if (ball.v.z >= -0.05 || ball.p.z <= planeZ) return null;

  let p = { ...ball.p };
  let v = { ...ball.v };
  let spin = { ...ball.spin };
  let previousZ = p.z;
  let predictedBounces = ball.bounces;
  const isServe = ball.serve;
  const dt = 1 / 240;
  const tableTop = TABLE.y + TABLE.ballRadius;

  for (let i = 0; i < 480; i += 1) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const magnus = cross(spin, v);
    const drag = 0.045 * speed;
    v = {
      x: v.x + (-drag * v.x + 0.00030 * magnus.x) * dt,
      y: v.y + (-9.81 - drag * v.y + 0.00030 * magnus.y) * dt,
      z: v.z + (-drag * v.z + 0.00030 * magnus.z) * dt,
    };
    const previous = { ...p };
    p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
    spin.x *= 1 - 0.12 * dt;
    spin.y *= 1 - 0.12 * dt;
    spin.z *= 1 - 0.12 * dt;

    if (previous.y >= tableTop && p.y <= tableTop && v.y < 0 &&
        Math.abs(p.x) <= TABLE.width / 2 && Math.abs(p.z) <= TABLE.length / 2) {
      p.y = tableTop;
      v.y = Math.abs(v.y) * 0.88;
      v.x *= 0.94;
      v.z *= 0.94;
      spin.x *= 0.91;
      spin.y *= 0.94;
      spin.z *= 0.91;
      predictedBounces += 1;
      // The authoritative simulation applies extra forward-speed loss on the
      // first serve bounce. Mirror it so the AI does not aim for an illegal,
      // pre-second-bounce interception point.
      if (isServe && predictedBounces === 1) v.z *= 0.62;
    }

    if (previousZ > planeZ && p.z <= planeZ) {
      const requiredBounces = isServe ? 2 : 1;
      if (predictedBounces < requiredBounces) return null;
      const fraction = clamp((previousZ - planeZ) / Math.max(1e-6, previousZ - p.z), 0, 1);
      return {
        x: previous.x + (p.x - previous.x) * fraction,
        y: previous.y + (p.y - previous.y) * fraction,
        time: (i + fraction) * dt,
      };
    }
    previousZ = p.z;
    if (p.y < TABLE.y - 0.1 || Math.abs(p.x) > 1.6 || p.z < -2.1) return null;
  }
  return null;
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

    const intercept = predictIntercept(sim);
    if (intercept && this.think <= 0) {
      this.think = level.reaction;
      // Choose one shot plan per incoming ball. The target is deliberately
      // offset only a few centimetres: the blade still has to physically
      // overlap the ball, while its lateral/upward movement shapes the return.
      if (this.plannedRally !== state.rallyHits) {
        this.plannedRally = state.rallyHits;
        const opponentX = state.paddles[0].x;
        const awayFromOpponent = opponentX >= 0 ? -1 : 1;
        const variation = Math.sin(state.rallyHits * 12.9898 + this.clock * 2.17);
        const direction = Math.abs(opponentX) < 0.16 ? (variation >= 0 ? 1 : -1) : awayFromOpponent;
        const precision = this.difficulty === "easy" ? 0.025 : this.difficulty === "normal" ? 0.045 : 0.065;
        this.shotOffset = direction * precision * (0.72 + Math.abs(variation) * 0.28);
        // Alternate a compact upward brush and a flatter drive. This changes
        // racket-head velocity, so spin comes from the same contact physics
        // used by a human player rather than an artificial ball modifier.
        this.shotHeight = (state.rallyHits % 2 === 0 ? 1 : -1) * (this.difficulty === "easy" ? 0.012 : 0.022);
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
