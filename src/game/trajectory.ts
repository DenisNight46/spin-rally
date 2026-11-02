import {
  applyTableBouncePhysics,
  integrateBallFlight,
  TABLE,
  type MatchState,
  type Side,
} from "@contracts/sim";

export interface RacketIntercept {
  x: number;
  y: number;
  time: number;
}

/**
 * Predict a legal ball crossing at either player's racket plane.
 * Flight and table contact use the same deterministic physics as the server.
 */
export function predictRacketIntercept(
  state: MatchState,
  side: Side,
  maxTime = 2,
  reachableOnly = false,
  planeDistance = 1.48,
): RacketIntercept | null {
  const sign = side === 0 ? 1 : -1;
  const reachPlane = Math.max(0.72, Math.min(1.48, planeDistance));
  const planeZ = sign * reachPlane;
  const ball = state.ball;
  if (ball.v.z * sign <= 0.05 || ball.p.z * sign >= reachPlane || !Number.isFinite(maxTime) || maxTime <= 0) {
    return null;
  }

  let p = { ...ball.p };
  let v = { ...ball.v };
  let spin = { ...ball.spin };
  let predictedBounces = ball.bounces;
  const isServe = ball.serve;
  const dt = 1 / 240;
  const tableTop = TABLE.y + TABLE.ballRadius;

  for (let i = 0; i < Math.ceil(maxTime / dt); i += 1) {
    const previous = { ...p };
    const predictedBall = { p, v, spin, serve: isServe };
    integrateBallFlight(predictedBall, dt);
    p = predictedBall.p;
    v = predictedBall.v;
    spin = predictedBall.spin;

    if (
      previous.y >= tableTop &&
      p.y <= tableTop &&
      v.y < 0 &&
      Math.abs(p.x) <= TABLE.width / 2 &&
      Math.abs(p.z) <= TABLE.length / 2
    ) {
      const maxLegalBounces = isServe ? 2 : 1;
      if (predictedBounces >= maxLegalBounces) return null;
      const fraction = Math.max(0, Math.min(1, (previous.y - tableTop) / Math.max(1e-7, previous.y - p.y)));
      p.x = previous.x + (p.x - previous.x) * fraction;
      p.z = previous.z + (p.z - previous.z) * fraction;
      p.y = tableTop;
      const bounceSide: Side = p.z >= 0 ? 0 : 1;
      const expectedSide: Side = predictedBounces === 0
        ? (isServe ? ball.lastHitter : ball.lastHitter === 0 ? 1 : 0)
        : (ball.lastHitter === 0 ? 1 : 0);
      if (bounceSide !== expectedSide) return null;
      applyTableBouncePhysics({ v, spin, serve: isServe }, predictedBounces + 1);
      predictedBounces += 1;
    }

    const crossed = sign > 0
      ? previous.z < planeZ && p.z >= planeZ
      : previous.z > planeZ && p.z <= planeZ;
    if (crossed) {
      const requiredBounces = isServe ? 2 : 1;
      if (predictedBounces < requiredBounces) return null;
      const fraction = Math.max(0, Math.min(1, (planeZ - previous.z) / (p.z - previous.z)));
      const intercept = {
        x: previous.x + (p.x - previous.x) * fraction,
        y: previous.y + (p.y - previous.y) * fraction,
        time: (i + fraction) * dt,
      };
      if (reachableOnly && (intercept.y < 0.62 || intercept.y > 1.72 || Math.abs(intercept.x) > 1.08)) {
        return null;
      }
      return intercept;
    }

    if (p.y < TABLE.y - 0.1 || Math.abs(p.x) > 1.6 || Math.abs(p.z) > 2.1) return null;
  }

  return null;
}


/**
 * Small aim-assist envelope for near-miss contacts. Touch assistance is
 * deliberately weaker so the racket never feels detached from the finger.
 */
export function getContactAssistWeight(distance: number, time: number, touch: boolean): number {
  // Assistance begins early enough for a human reaction, but is bounded to a
  // nearby legal intercept and fades completely outside the envelope.
  const maxDistance = 0.38;
  const maxTime = 0.34;
  if (!Number.isFinite(distance) || !Number.isFinite(time) || distance < 0 || time <= 0 || time >= maxTime || distance >= maxDistance) {
    return 0;
  }
  const strength = touch ? 0.12 : 0.20;
  const proximity = 1 - distance / maxDistance;
  const urgency = 1 - time / maxTime;
  return strength * proximity * urgency;
}

export interface SpinVisualProfile {
  strength: number;
  color: "#ffb45e" | "#65b9ff" | "#bb8cff" | "#d8fff5";
  kind: "topspin" | "backspin" | "sidespin" | "corkscrew";
}

/** Convert physical spin into a restrained, readable arcade visual cue. */
export function getSpinVisualProfile(spin: { x: number; y: number; z: number }): SpinVisualProfile {
  const x = Number.isFinite(spin.x) ? spin.x : 0;
  const y = Number.isFinite(spin.y) ? spin.y : 0;
  const z = Number.isFinite(spin.z) ? spin.z : 0;
  const magnitude = Math.hypot(x, y, z);
  if (Math.abs(y) > Math.abs(x) && Math.abs(y) > Math.abs(z)) {
    return { strength: Math.min(1, magnitude / 44), color: "#d8fff5", kind: "corkscrew" };
  }
  if (Math.abs(z) > Math.abs(x)) {
    return { strength: Math.min(1, magnitude / 44), color: "#bb8cff", kind: "sidespin" };
  }
  return x >= 0
    ? { strength: Math.min(1, magnitude / 44), color: "#ffb45e", kind: "topspin" }
    : { strength: Math.min(1, magnitude / 44), color: "#65b9ff", kind: "backspin" };
}
