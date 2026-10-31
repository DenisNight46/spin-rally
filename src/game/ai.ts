import { DEFAULT_INPUT, TABLE, type PaddleInput, type TableTennisSim, type Vec3 } from "@contracts/sim";

export type Difficulty = "easy" | "normal" | "hard";

const LEVELS = {
  easy: { reaction: 0.22, speed: 0.76, error: 0.12, anticipation: 0.12 },
  normal: { reaction: 0.12, speed: 0.94, error: 0.045, anticipation: 0.07 },
  hard: { reaction: 0.065, speed: 1, error: 0.018, anticipation: 0.035 },
} as const;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Predict the ball's future position at the AI racket plane.
 * This uses the same gravity, drag, Magnus lift and table bounce conventions
 * as the authoritative simulation, rather than aiming at the current ball.
 */
function predictIntercept(sim: TableTennisSim): { x: number; y: number; time: number } | null {
  const ball = sim.state.ball;
  const planeZ = -1.25;
  if (ball.v.z >= -0.05 || ball.p.z <= planeZ) return null;

  let p = { ...ball.p };
  let v = { ...ball.v };
  let spin = { ...ball.spin };
  let previousZ = p.z;
  const dt = 1 / 240;
  const tableTop = TABLE.y + TABLE.ballRadius;

  for (let i = 0; i < 360; i += 1) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const magnus = cross(spin, v);
    const drag = 0.045 * speed;
    v = {
      x: v.x + (-drag * v.x + 0.00030 * magnus.x) * dt,
      y: v.y + (-9.81 - drag * v.y + 0.00030 * magnus.y) * dt,
      z: v.z + (-drag * v.z + 0.00030 * magnus.z) * dt,
    };
    const previousY = p.y;
    p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
    spin.x *= 1 - 0.12 * dt;
    spin.y *= 1 - 0.12 * dt;
    spin.z *= 1 - 0.12 * dt;

    if (previousY >= tableTop && p.y <= tableTop && v.y < 0 &&
        Math.abs(p.x) <= TABLE.width / 2 && Math.abs(p.z) <= TABLE.length / 2) {
      p.y = tableTop;
      v.y = Math.abs(v.y) * 0.88;
      v.x *= 0.94;
      v.z *= 0.94;
      spin.x *= 0.91;
      spin.y *= 0.94;
      spin.z *= 0.91;
    }

    if (previousZ > planeZ && p.z <= planeZ) {
      const fraction = clamp((previousZ - planeZ) / Math.max(1e-6, previousZ - p.z), 0, 1);
      return {
        x: p.x,
        y: p.y,
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
  private input: PaddleInput = { ...DEFAULT_INPUT, z: -1.25 };

  constructor(private difficulty: Difficulty = "normal") {}

  reset(): void {
    this.think = 0;
    this.serveDelay = 0;
    this.input = { ...DEFAULT_INPUT, z: -1.25 };
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
      this.input.x += (0 - this.input.x) * Math.min(1, dt * 4);
      this.input.y += (1.17 - this.input.y) * Math.min(1, dt * 4);
      this.input.z = -1.25;
      if (state.server === 1 && this.serveDelay > 0.72) {
        this.input.serve = true;
        this.serveDelay = 0;
      }
      sim.setInput(1, this.input);
      return;
    }

    if (state.phase !== "rally") {
      this.serveDelay = 0;
      this.input.x += (0 - this.input.x) * Math.min(1, dt * 2.5);
      this.input.y += (1.17 - this.input.y) * Math.min(1, dt * 2.5);
      sim.setInput(1, this.input);
      return;
    }

    const intercept = predictIntercept(sim);
    if (intercept && this.think <= 0) {
      this.think = level.reaction;
      const error = Math.sin(this.clock * 7.13 + state.rallyHits * 2.7) * level.error;
      const timeToHit = intercept.time;
      // Start moving as soon as the opponent has struck; finish the approach
      // before contact and use a compact upward/forward swing through the ball.
      const prepare = timeToHit > level.anticipation;
      const targetX = intercept.x + error;
      const targetY = intercept.y + (prepare ? -0.10 : 0.10);
      this.input.x = clamp(targetX, -0.94, 0.94);
      this.input.y = clamp(targetY, 0.84, 1.66);
      this.input.z = -1.25;
    } else if (!intercept && state.ball.v.z >= 0) {
      // Recover to a balanced ready position while the ball travels away.
      this.input.x += (0 - this.input.x) * Math.min(1, dt * 2.2 * level.speed);
      this.input.y += (1.17 - this.input.y) * Math.min(1, dt * 2.2);
      this.input.z = -1.25;
    }

    sim.setInput(1, this.input);
  }
}
