import { describe, expect, it } from "vitest";
import { TableTennisSim, type Side } from "../contracts/sim";

/** Award a point through the simulation's real out-of-bounds path. */
function awardPoint(sim: TableTennisSim, winner: Side): void {
  sim.state.phase = "rally";
  sim.state.ball = {
    p: { x: 1.54, y: 1.1, z: 0.5 },
    v: { x: 3, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    lastHitter: winner,
    bounces: 1,
    firstBounce: winner === 0 ? 1 : 0,
    serve: false,
  };
  sim.step(1 / 240);
  expect(["point", "gameover"]).toContain(sim.state.phase);
  expect(sim.state.lastPoint).toBe(winner);
}

/** Let the point-break timer finish and require the next serve phase. */
function advanceToNextServe(sim: TableTennisSim): void {
  for (let frame = 0; frame < 32 && sim.state.phase === "point"; frame++) {
    sim.step(0.08);
  }
  expect(sim.state.phase).toBe("serve");
}

describe("table-tennis service rotation", () => {
  it("keeps the same server for the first two points, then changes server", () => {
    const sim = new TableTennisSim(211);
    sim.startMatch();
    expect(sim.state.server).toBe(0);

    awardPoint(sim, 0);
    advanceToNextServe(sim);
    expect(sim.state.server).toBe(0);

    awardPoint(sim, 0);
    advanceToNextServe(sim);
    expect(sim.state.server).toBe(1);
  });

  it("alternates the server after every point at deuce", () => {
    const sim = new TableTennisSim(223);
    sim.startMatch();
    sim.state.scores = [10, 10];

    awardPoint(sim, 0);
    advanceToNextServe(sim);
    expect(sim.state.server).toBe(1);

    awardPoint(sim, 0);
    advanceToNextServe(sim);
    expect(sim.state.server).toBe(0);
  });

  it("alternates the first server between games", () => {
    const sim = new TableTennisSim(227);
    sim.startMatch();
    sim.state.scores = [10, 0];

    awardPoint(sim, 0);
    advanceToNextServe(sim);
    expect(sim.state.games).toEqual([1, 0]);
    expect(sim.state.gameNumber).toBe(2);
    expect(sim.state.server).toBe(1);
  });
});
