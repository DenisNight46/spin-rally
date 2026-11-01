export const TRAINING_TARGET = 10;

export interface TrainingProgress {
  current: number;
  best: number;
  percent: number;
  complete: boolean;
}

export function getTrainingProgress(rallyHits: number, best: number): TrainingProgress {
  const safeCurrent = Number.isFinite(rallyHits) ? Math.max(0, Math.floor(rallyHits)) : 0;
  const safeBest = Number.isFinite(best) ? Math.max(0, Math.floor(best)) : 0;
  return {
    current: Math.min(TRAINING_TARGET, safeCurrent),
    best: Math.max(safeBest, safeCurrent),
    percent: Math.min(100, (safeCurrent / TRAINING_TARGET) * 100),
    complete: safeCurrent >= TRAINING_TARGET,
  };
}


export const ACCURACY_TARGET = Object.freeze({ x: 0, z: -0.94, radius: 0.24 });

/** Returns whether a landing point is inside the marked precision target. */
export function isAccuracyTargetHit(point: { x: number; z: number } | undefined): boolean {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  return Math.hypot(point.x - ACCURACY_TARGET.x, point.z - ACCURACY_TARGET.z) <= ACCURACY_TARGET.radius;
}
