import { describe, expect, it } from "vitest";
import { TableTennisSim, type Side } from "../contracts/sim";

/** Award a point through the real out-of-bounds collision path, not private methods. */
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

describe("table-tennis scoring", () => {
  it("awards a game at 11 only when the lead is at least two", () => {
    const sim = new TableTennisSim(101);
    sim.startMatch();
    sim.state.scores = [10, 0];

    awardPoint(sim, 0);

    expect(sim.state.scores).toEqual([11, 0]);
    expect(sim.state.games).toEqual([1, 0]);
    expect(sim.state.message).toContain("Партия");
  });

  it("continues deuce at 11:10 and ends the game at 12:10", () => {
    const sim = new TableTennisSim(103);
    sim.startMatch();
    sim.state.scores = [10, 10];

    awardPoint(sim, 0);
    expect(sim.state.scores).toEqual([11, 10]);
    expect(sim.state.games).toEqual([0, 0]);

    awardPoint(sim, 0);
    expect(sim.state.scores).toEqual([12, 10]);
    expect(sim.state.games).toEqual([1, 0]);
  });

  it("requires two games to win the match", () => {
    const sim = new TableTennisSim(107);
    sim.startMatch();
    sim.state.games = [1, 0];
    sim.state.scores = [10, 0];

    awardPoint(sim, 0);

    expect(sim.state.phase).toBe("gameover");
    expect(sim.state.winner).toBe(0);
    expect(sim.state.games).toEqual([2, 0]);
  });

  it("does not declare a match winner when the opponent reaches one game", () => {
    const sim = new TableTennisSim(109);
    sim.startMatch();
    sim.state.games = [0, 0];
    sim.state.scores = [10, 0];

    awardPoint(sim, 0);

    expect(sim.state.phase).toBe("point");
    expect(sim.state.winner).toBeNull();
    expect(sim.state.games).toEqual([1, 0]);
  });
});
