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
