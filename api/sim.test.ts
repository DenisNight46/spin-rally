import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, TABLE, TableTennisSim } from "../contracts/sim";
import { TableTennisAI } from "../src/game/ai";
import { NATIONAL_TEAMS, NATIONAL_TEAM_FLAG_CODES, getNationalTeam, getTeamsByConfederation } from "../src/game/teams";

function racketImpact(targetX: number, targetY: number) {
  const sim = new TableTennisSim(7);
  sim.startMatch();
  sim.state.phase = "rally";
  sim.state.ball = {
    p: { x: 0, y: 1.12, z: 1.37 },
    v: { x: 0, y: 0, z: 5 },
    spin: { x: 0, y: 0, z: 0 },
    lastHitter: 1,
    bounces: 1,
    firstBounce: 0,
    serve: false,
  };
  const paddle = sim.state.paddles[0];
  paddle.x = 0; paddle.y = 1.12; paddle.z = 1.4;
  paddle.prevY = 1.12; paddle.prevZ = 1.4;
  sim.setInput(0, { ...DEFAULT_INPUT, x: targetX, y: targetY, z: 1.4 });
  for (let i = 0; i < 100; i += 1) {
    sim.step(1 / 240);
    if (sim.state.event?.type === "hit") break;
  }
  return sim.state.ball.spin;
}

describe("table tennis ball physics", () => {
  it("uses regulation table and ball dimensions", () => {
    expect(TABLE.width).toBe(1.525);
    expect(TABLE.length).toBe(2.74);
    expect(TABLE.y).toBe(0.76);
    expect(TABLE.netHeight).toBe(0.1525);
    expect(TABLE.ballRadius).toBe(0.02);
  });

  it("generates topspin from an upward racket swing without a modifier key", () => {
    const still = racketImpact(0, 1.12);
    const upward = racketImpact(0, 1.7);
    expect(Math.abs(upward.x)).toBeGreaterThan(Math.abs(still.x) + 30);
  });

  it("generates sidespin from horizontal racket movement", () => {
    const still = racketImpact(0, 1.12);
    const sideways = racketImpact(0.98, 1.12);
    expect(Math.abs(sideways.y)).toBeGreaterThan(Math.abs(still.y) + 10);
  });

  it("serves with a bounce on the server half and then the receiver half", () => {
    const sim = new TableTennisSim(11);
    sim.startMatch();
    sim.setInput(0, { ...DEFAULT_INPUT, z: 1.4, serve: true });
    const bounceZ: number[] = [];
    let lastEvent = sim.state.eventId;
    for (let i = 0; i < 500 && bounceZ.length < 2; i += 1) {
      sim.step(1 / 120);
      if (sim.state.eventId !== lastEvent) {
        lastEvent = sim.state.eventId;
        if (sim.state.event?.type === "bounce" && sim.state.event.p) bounceZ.push(sim.state.event.p.z);
      }
    }
    expect(bounceZ).toHaveLength(2);
    expect(bounceZ[0]).toBeGreaterThan(0);
    expect(bounceZ[1]).toBeLessThan(0);
  });

  it("allows the AI to make a physical return", () => {
    const sim = new TableTennisSim(3);
    const ai = new TableTennisAI("normal");
    sim.startMatch();
    sim.setInput(0, { ...DEFAULT_INPUT, z: 1.4, serve: true });
    let hit = false;
    let lastEvent = sim.state.eventId;
    let lastBounces = sim.state.ball.bounces;
    const trace: unknown[] = [];
    for (let i = 0; i < 600 && !hit; i += 1) {
      ai.update(sim, 1 / 60);
      sim.step(1 / 120);
      sim.step(1 / 120);
      const { ball, paddles } = sim.state;
      if (i % 30 === 0 || ball.bounces !== lastBounces || Math.abs(ball.p.z) < 0.25 || sim.state.eventId !== lastEvent) {
        trace.push({
          frame: i,
          phase: sim.state.phase,
          event: sim.state.event,
          eventId: sim.state.eventId,
          ball: { p: { ...ball.p }, v: { ...ball.v }, bounces: ball.bounces, lastHitter: ball.lastHitter, serve: ball.serve },
          aiPaddle: { x: paddles[1].x, y: paddles[1].y, z: paddles[1].z, vx: paddles[1].vx, vy: paddles[1].vy, vz: paddles[1].vz },
          aiInput: { ...sim.getInput(1) },
        });
        if (trace.length > 24) trace.shift();
      }
      lastBounces = ball.bounces;
      if (sim.state.eventId !== lastEvent) {
        lastEvent = sim.state.eventId;
        hit = sim.state.event?.type === "hit";
      }
    }
    expect(hit, `AI return diagnostics:\n${JSON.stringify({ finalPhase: sim.state.phase, finalMessage: sim.state.message, finalBall: sim.state.ball, trace }, null, 2)}`).toBe(true);
  });

  it("varies AI service placement across the legal table width", () => {
    const sim = new TableTennisSim(19);
    const ai = new TableTennisAI("hard");
    sim.startMatch();
    const placements: number[] = [];

    for (let serve = 0; serve < 5; serve += 1) {
      sim.state.phase = "serve";
      sim.state.server = 1;
      sim.state.ball.serve = true;
      sim.state.ball.bounces = 0;
      sim.state.paddles[1].x = 0;
      let lastEvent = sim.state.eventId;

      for (let frame = 0; frame < 120 && sim.state.phase === "serve"; frame += 1) {
        ai.update(sim, 1 / 60);
        sim.step(1 / 120);
        sim.step(1 / 120);
        if (sim.state.eventId !== lastEvent) {
          lastEvent = sim.state.eventId;
          if (sim.state.event?.type === "serve" && sim.state.event.p) {
            placements.push(sim.state.event.p.x);
          }
        }
      }
      expect(sim.state.phase).toBe("rally");
    }

    expect(placements).toHaveLength(5);
    expect(new Set(placements.map((x) => x.toFixed(2))).size).toBeGreaterThanOrEqual(4);
    expect(placements.every((x) => Math.abs(x) <= 0.65)).toBe(true);
  });


  it.each(["easy", "normal", "hard"] as const)("returns a legal serve on %s difficulty", (difficulty) => {
    const sim = new TableTennisSim(3);
    const ai = new TableTennisAI(difficulty);
    sim.startMatch();
    sim.setInput(0, { ...DEFAULT_INPUT, z: 1.4, serve: true });
    let returned = false;
    let lastEvent = sim.state.eventId;

    for (let i = 0; i < 720 && !returned; i += 1) {
      ai.update(sim, 1 / 60);
      sim.step(1 / 120);
      sim.step(1 / 120);
      if (sim.state.eventId !== lastEvent) {
        lastEvent = sim.state.eventId;
        returned = sim.state.event?.type === "hit" && sim.state.event.side === 1;
      }
    }

    expect(returned, `AI failed to return a legal serve on ${difficulty} difficulty`).toBe(true);
  });
});


describe("national team catalogue", () => {
  it("contains 32 uniquely identified national teams", () => {
    expect(NATIONAL_TEAMS).toHaveLength(32);
    expect(new Set(NATIONAL_TEAMS.map((team) => team.id)).size).toBe(32);
    expect(new Set(NATIONAL_TEAMS.map((team) => team.shortName)).size).toBe(32);
  });

  it("provides a valid flag asset code and original crest for every team", () => {
    for (const team of NATIONAL_TEAMS) {
      expect(NATIONAL_TEAM_FLAG_CODES[team.id], `missing flag mapping for ${team.id}`).toMatch(/^[a-z]{2}$/);
      expect(team.flag, `missing flag emoji for ${team.id}`).toBeTruthy();
      expect(team.crest.initials, `missing crest initials for ${team.id}`).toBeTruthy();
      for (const color of [team.crest.primary, team.crest.secondary, team.crest.accent]) {
        expect(color, `invalid crest color for ${team.id}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("filters every confederation without losing or duplicating teams", () => {
    const regions = ["Asia", "Europe", "Africa", "Americas"] as const;
    const filtered = regions.flatMap((region) => getTeamsByConfederation(region));
    expect(getTeamsByConfederation("All")).toHaveLength(32);
    expect(getTeamsByConfederation("Asia")).toHaveLength(12);
    expect(getTeamsByConfederation("Europe")).toHaveLength(17);
    expect(getTeamsByConfederation("Africa")).toHaveLength(1);
    expect(getTeamsByConfederation("Americas")).toHaveLength(2);
    expect(new Set(filtered.map((team) => team.id)).size).toBe(32);
    expect(filtered.map((team) => team.id).sort()).toEqual(NATIONAL_TEAMS.map((team) => team.id).sort());
  });

  it("resolves known teams and safely returns undefined for unknown ids", () => {
    expect(getNationalTeam("rus")?.name).toBe("Россия");
    expect(getNationalTeam("chn")?.name).toBe("Китай");
    expect(getNationalTeam("not-a-team")).toBeUndefined();
  });
});
