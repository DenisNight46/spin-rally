import type { MatchState, Side } from "@contracts/sim";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cloneState = (state: MatchState): MatchState => structuredClone(state);

/** Interpolate continuous motion, but never blend across a point, serve, or game transition. */
export function interpolateMatchStates(a: MatchState, b: MatchState, amount: number): MatchState {
  const t = Math.max(0, Math.min(1, amount));
  const discontinuity =
    a.phase !== b.phase ||
    a.eventId !== b.eventId ||
    a.rallyHits !== b.rallyHits ||
    a.server !== b.server ||
    a.ball.bounces !== b.ball.bounces ||
    a.ball.firstBounce !== b.ball.firstBounce ||
    a.ball.serve !== b.ball.serve ||
    a.ball.lastHitter !== b.ball.lastHitter ||
    a.gameNumber !== b.gameNumber ||
    a.scores[0] !== b.scores[0] ||
    a.scores[1] !== b.scores[1] ||
    a.games[0] !== b.games[0] ||
    a.games[1] !== b.games[1];
  if (discontinuity) return cloneState(t >= 1 ? b : a);

  const out = cloneState(t < 0.5 ? a : b);
  const mix = (x: number, y: number) => lerp(x, y, t);
  for (const key of ["x", "y", "z"] as const) {
    out.ball.p[key] = mix(a.ball.p[key], b.ball.p[key]);
    out.ball.v[key] = mix(a.ball.v[key], b.ball.v[key]);
    out.ball.spin[key] = mix(a.ball.spin[key], b.ball.spin[key]);
  }
  for (const side of [0, 1] as Side[]) {
    for (const key of ["x", "y", "z", "vx", "vy", "vz"] as const) {
      out.paddles[side][key] = mix(a.paddles[side][key], b.paddles[side][key]);
    }
  }
  return out;
}
