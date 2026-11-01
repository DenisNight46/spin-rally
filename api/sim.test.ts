import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, TABLE, TableTennisSim } from "../contracts/sim";
import { planAIShot, predictAIIntercept, TableTennisAI } from "../src/game/ai";
import { predictRacketIntercept } from "../src/game/trajectory";
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

describe("online snapshot interpolation", () => {
  it("smooths continuous ball and paddle motion", async () => {
    const { interpolateMatchStates } = await import("../src/game/interpolation");
    const first = new TableTennisSim(101);
    const second = new TableTennisSim(101);
    first.startMatch();
    second.startMatch();
    first.state.phase = second.state.phase = "rally";
    first.state.ball.p.x = 0;
    second.state.ball.p.x = 1;
    first.state.paddles[0].x = -0.5;
    second.state.paddles[0].x = 0.5;

    const middle = interpolateMatchStates(first.state, second.state, 0.5);
    expect(middle.ball.p.x).toBeCloseTo(0.5);
    expect(middle.paddles[0].x).toBeCloseTo(0);
  });

  it("snaps instead of blending discrete ball-contact transitions", async () => {
    const { interpolateMatchStates } = await import("../src/game/interpolation");
    const base = new TableTennisSim(105);
    base.startMatch();
    base.state.phase = "rally";

    const transitions: Array<(state: typeof base.state) => void> = [
      (state) => { state.ball.bounces += 1; },
      (state) => { state.ball.firstBounce = 0; },
      (state) => { state.ball.serve = false; },
      (state) => { state.ball.lastHitter = 1; },
    ];

    for (const transition of transitions) {
      const before = structuredClone(base.state);
      const after = structuredClone(base.state);
      after.ball.p.x = 0.8;
      transition(after);
      const middle = interpolateMatchStates(before, after, 0.5);
      expect(middle.ball.p.x).toBe(before.ball.p.x);
    }
  });

  it("does not interpolate through a point or phase transition", async () => {
    const { interpolateMatchStates } = await import("../src/game/interpolation");
    const first = new TableTennisSim(103);
    const second = new TableTennisSim(103);
    first.startMatch();
    second.startMatch();
    first.state.phase = "rally";
    second.state.phase = "serve";
    first.state.ball.p.x = -0.4;
    second.state.ball.p.x = 0.8;
    second.state.eventId += 1;
    second.state.scores[0] += 1;

    const beforeTransition = interpolateMatchStates(first.state, second.state, 0.99);
    const afterTransition = interpolateMatchStates(first.state, second.state, 1);
    expect(beforeTransition.ball.p.x).toBe(-0.4);
    expect(afterTransition.ball.p.x).toBe(0.8);
    expect(afterTransition.scores[0]).toBe(1);
  });
});

describe("shared racket trajectory prediction", () => {
  it("is symmetric for both racket planes", () => {
    const sim = new TableTennisSim(107);
    sim.startMatch();
    sim.state.phase = "rally";
    sim.state.ball = {
      p: { x: 0.2, y: 1.1, z: -0.9 },
      v: { x: 0.3, y: 0.2, z: -3 },
      spin: { x: 0, y: 0, z: 0 },
      lastHitter: 0,
      bounces: 1,
      firstBounce: 0,
      serve: false,
    };
    const left = predictRacketIntercept(sim.state, 1);
    const mirrored = structuredClone(sim.state);
    mirrored.ball.p.z *= -1;
    mirrored.ball.v.z *= -1;
    mirrored.ball.lastHitter = 1;
    mirrored.ball.firstBounce = 1;
    const right = predictRacketIntercept(mirrored, 0);

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(right?.x).toBeCloseTo(left?.x ?? 0, 6);
    expect(right?.y).toBeCloseTo(left?.y ?? 0, 6);
    expect(right?.time).toBeCloseTo(left?.time ?? 0, 6);
  });

  it("does not predict a serve contact before the receiver's second bounce", () => {
    const sim = new TableTennisSim(109);
    sim.startMatch();
    sim.state.phase = "rally";
    sim.state.ball = {
      p: { x: 0, y: 1.1, z: -1 },
      v: { x: 0, y: -1.4, z: -3 },
      spin: { x: 0, y: 0, z: 0 },
      lastHitter: 1,
      bounces: 0,
      firstBounce: null,
      serve: true,
    };

    expect(predictRacketIntercept(sim.state, 1)).toBeNull();
  });
});

describe("AI tactical shot planning", () => {
  it("anticipates lateral movement and attacks the newly exposed side", () => {
    const stationaryPlan = planAIShot("hard", 0, -0.55, 0, 0.25, 0.5);
    const movingRightPlan = planAIShot("hard", 0, -0.55, 5, 0.25, 0.5);

    expect(stationaryPlan.offset).toBeGreaterThan(0);
    expect(movingRightPlan.predictedOpponentX).toBeGreaterThan(0);
    expect(movingRightPlan.offset).toBeLessThan(0);
  });

  it("keeps beginner returns central and alternates the club player's placement", () => {
    const easy = planAIShot("easy", 2, 0.8, 5, 0.3, -0.7);
    const normalLeft = planAIShot("normal", 2, 0.8, 5, 0.3, -0.7);
    const normalRight = planAIShot("normal", 3, 0.8, 5, 0.3, -0.7);

    expect(easy.offset).toBe(0);
    expect(easy.brush).toBe("flat");
    expect(normalLeft.brush).toBe("up");
    expect(normalRight.brush).toBe("down");
    expect(normalLeft.offset).toBeGreaterThan(0);
    expect(normalRight.offset).toBeLessThan(0);
  });

  it("varies racket brush to create different spin profiles and counters heavy incoming spin", () => {
    const flat = planAIShot("easy", 0, 0, 0, 0.2, 0.4, 30);
    const clubUp = planAIShot("normal", 0, 0, 0, 0.2, 0.4, 30);
    const clubDown = planAIShot("normal", 1, 0, 0, 0.2, 0.4, 30);
    const expertCounter = planAIShot("hard", 0, 0, 0, 0.2, 0.4, -30);

    expect(flat).toMatchObject({ brush: "flat", height: 0 });
    expect(clubUp.brush).toBe("up");
    expect(clubUp.height).toBeGreaterThan(0.05);
    expect(clubDown.brush).toBe("down");
    expect(clubDown.height).toBeLessThan(-0.05);
    expect(expertCounter.brush).toBe("down");
    expect(expertCounter.height).toBeLessThan(0);
  });

  it("bounds opponent anticipation to the legal lateral range", () => {
    const plan = planAIShot("hard", 4, 0.9, 100, 0.5, 1);
    expect(plan.predictedOpponentX).toBe(0.98);
    expect(plan.offset).toBeLessThan(0);
    expect(Math.abs(plan.offset)).toBeLessThanOrEqual(0.095);
  });
});

describe("AI trajectory prediction", () => {
  it("matches the authoritative simulation through a high-spin table bounce", () => {
    const sim = new TableTennisSim(83);
    sim.startMatch();
    sim.state.phase = "rally";
    sim.state.ball = {
      p: { x: 0.35, y: 0.92, z: -0.65 },
      v: { x: 0.7, y: -0.3, z: -3.4 },
      spin: { x: 38, y: -24, z: 17 },
      lastHitter: 0,
      bounces: 0,
      firstBounce: null,
      serve: false,
    };
    sim.state.paddles[1].x = -0.9;
    sim.state.paddles[1].y = 0.84;
    sim.state.paddles[1].prevX = -0.9;
    sim.state.paddles[1].prevY = 0.84;
    sim.setInput(1, { ...DEFAULT_INPUT, x: -0.9, y: 0.84, z: -1.48 });

    const predicted = predictAIIntercept(sim);
    expect(predicted).not.toBeNull();
    if (!predicted) throw new Error("AI did not predict a legal racket-plane crossing");

    let actual: { x: number; y: number; time: number } | null = null;
    const dt = 1 / 240;
    for (let frame = 0; frame < 240; frame += 1) {
      const before = { ...sim.state.ball.p };
      sim.step(dt);
      const after = sim.state.ball.p;
      if (before.z > -1.48 && after.z <= -1.48) {
        const fraction = (before.z + 1.48) / (before.z - after.z);
        actual = {
          x: before.x + (after.x - before.x) * fraction,
          y: before.y + (after.y - before.y) * fraction,
          time: (frame + fraction) * dt,
        };
        break;
      }
    }

    expect(actual).not.toBeNull();
    if (!actual) throw new Error("Authoritative ball did not reach the AI racket plane");
    expect(predicted.x).toBeCloseTo(actual.x, 2);
    expect(predicted.y).toBeCloseTo(actual.y, 2);
    expect(predicted.time).toBeCloseTo(actual.time, 2);
  });
});

describe("table tennis ball physics", () => {
  it("uses regulation table and ball dimensions", () => {
    expect(TABLE.width).toBe(1.525);
    expect(TABLE.length).toBe(2.74);
    expect(TABLE.y).toBe(0.76);
    expect(TABLE.netHeight).toBe(0.1525);
    expect(TABLE.ballRadius).toBe(0.02);
  });

  it("clamps remote racket targets and replaces non-finite coordinates safely", () => {
    const sim = new TableTennisSim(23);
    sim.setInput(0, { ...DEFAULT_INPUT, x: 500, y: -500, z: -500 });
    expect(sim.getInput(0)).toMatchObject({ x: 0.98, y: 0.84, z: 1.38 });

    sim.setInput(1, { ...DEFAULT_INPUT, x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NaN });
    expect(sim.getInput(1)).toMatchObject({ x: 0, y: 1.16, z: -1.48 });
  });

  it("limits racket acceleration and speed instead of allowing target teleportation", () => {
    const sim = new TableTennisSim(29);
    sim.startMatch();
    sim.setInput(0, { ...DEFAULT_INPUT, x: 0.98, y: 1.7, z: 1.75 });

    sim.step(1 / 240);
    const paddle = sim.state.paddles[0];
    expect(Math.hypot(paddle.vx, paddle.vy, paddle.vz)).toBeLessThanOrEqual(70 * (1 / 240) * Math.sqrt(3) + 1e-9);

    for (let frame = 0; frame < 120; frame += 1) sim.step(1 / 240);
    expect(Math.abs(paddle.vx)).toBeLessThanOrEqual(10.5);
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(10.5);
    expect(Math.abs(paddle.vz)).toBeLessThanOrEqual(10.5);
  });

  it("fully resets paddles and queued inputs when a match is restarted", () => {
    const sim = new TableTennisSim(37);
    sim.startMatch();
    sim.setInput(0, { ...DEFAULT_INPUT, x: 0.8, y: 1.6, serve: true });
    sim.setInput(1, { ...DEFAULT_INPUT, x: -0.7, y: 0.9, z: -1.7, serve: true });
    sim.state.paddles[0].x = 0.72;
    sim.state.paddles[0].vx = 8;
    sim.state.paddles[1].x = -0.63;
    sim.state.paddles[1].vy = -6;

    sim.startMatch();

    expect(sim.getInput(0)).toEqual({ ...DEFAULT_INPUT });
    expect(sim.getInput(1)).toEqual({ ...DEFAULT_INPUT, z: -1.48 });
    expect(sim.state.paddles[0]).toMatchObject({ x: 0, y: 1.16, z: 1.48, vx: 0, vy: 0, vz: 0 });
    expect(sim.state.paddles[1]).toMatchObject({ x: 0, y: 1.16, z: -1.48, vx: 0, vy: 0, vz: 0 });
    expect(sim.state.phase).toBe("serve");
    expect(sim.state.server).toBe(0);
  });

  it("ignores invalid frame deltas without corrupting the fixed-step clock", () => {
    const guarded = new TableTennisSim(19);
    const reference = new TableTennisSim(19);
    guarded.startMatch();
    reference.startMatch();

    const before = structuredClone(guarded.state);
    guarded.step(Number.NaN);
    guarded.step(Number.POSITIVE_INFINITY);
    guarded.step(-1);
    expect(guarded.state).toEqual(before);

    guarded.step(1 / 60);
    reference.step(1 / 60);
    expect(guarded.state).toEqual(reference.state);
  });


  it("keeps the full simulation state finite during an extended match", () => {
    const sim = new TableTennisSim(41);
    sim.startMatch();
    sim.setInput(0, { ...DEFAULT_INPUT, z: 1.4, serve: true });

    for (let frame = 0; frame < 12_000; frame += 1) {
      sim.step(1 / 120);
      const { ball, paddles, scores, games } = sim.state;
      const values = [
        ball.p.x, ball.p.y, ball.p.z,
        ball.v.x, ball.v.y, ball.v.z,
        ball.spin.x, ball.spin.y, ball.spin.z,
        ...paddles.flatMap((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.cooldown]),
        ...scores, ...games,
      ];
      expect(values.every(Number.isFinite), `non-finite simulation value at frame ${frame}`).toBe(true);
      expect(Math.abs(ball.p.x)).toBeLessThan(100);
      expect(Math.abs(ball.p.y)).toBeLessThan(100);
      expect(Math.abs(ball.p.z)).toBeLessThan(100);
    }
  });

  it("produces identical states for identical seeds and input timelines", () => {
    const first = new TableTennisSim(73);
    const second = new TableTennisSim(73);
    first.startMatch();
    second.startMatch();

    for (let frame = 0; frame < 2_400; frame += 1) {
      const input = {
        ...DEFAULT_INPUT,
        x: Math.sin(frame * 0.013) * 0.7,
        y: 1.1 + Math.cos(frame * 0.009) * 0.25,
        z: 1.4,
        serve: frame === 0,
      };
      first.setInput(0, input);
      second.setInput(0, input);
      first.step(1 / 120);
      second.step(1 / 120);
      expect(second.state).toEqual(first.state);
    }
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

  it("gives each AI difficulty a distinct rally-placement strategy", () => {
    const makeReturn = (difficulty: "easy" | "normal" | "hard", rallyHits: number, opponentX: number) => {
      const sim = new TableTennisSim(31);
      sim.startMatch();
      sim.state.phase = "rally";
      sim.state.rallyHits = rallyHits;
      sim.state.paddles[0].x = opponentX;
      sim.state.ball = {
        p: { x: 0, y: 1.2, z: -1.2 },
        v: { x: 0, y: 0, z: -5 },
        spin: { x: 0, y: 0, z: 0 },
        lastHitter: 0,
        bounces: 1,
        firstBounce: 0,
        serve: false,
      };
      const ai = new TableTennisAI(difficulty);
      ai.update(sim, 1 / 60);
      return sim.getInput(1).x;
    };

    const beginner = makeReturn("easy", 0, 0.55);
    const clubLeft = makeReturn("normal", 0, 0.55);
    const clubRight = makeReturn("normal", 1, 0.55);
    const expert = makeReturn("hard", 0, 0.55);

    expect(Math.abs(beginner)).toBeLessThan(0.01);
    expect(clubLeft).toBeGreaterThan(0);
    expect(clubRight).toBeLessThan(0);
    expect(expert).toBeLessThan(clubLeft - 0.02);
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

describe("training drill progress", () => {
  it("clamps the displayed streak to the ten-hit objective", async () => {
    const { getTrainingProgress } = await import("../src/game/training");
    expect(getTrainingProgress(0, 4)).toEqual({ current: 0, best: 4, percent: 0, complete: false });
    expect(getTrainingProgress(7, 4)).toEqual({ current: 7, best: 7, percent: 70, complete: false });
    expect(getTrainingProgress(14, 9)).toEqual({ current: 10, best: 14, percent: 100, complete: true });
  });

  it("handles invalid counters without producing invalid UI values", async () => {
    const { getTrainingProgress } = await import("../src/game/training");
    expect(getTrainingProgress(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ current: 0, best: 0, percent: 0, complete: false });
  });
});


describe("network heartbeat health", () => {
  it("detects a stalled connection only after the timeout", async () => {
    const { isHeartbeatTimedOut, NETWORK_HEARTBEAT_TIMEOUT_MS } = await import("../src/game/network-health");
    expect(isHeartbeatTimedOut(1_000, 8_999)).toBe(false);
    expect(isHeartbeatTimedOut(1_000, 9_000)).toBe(true);
    expect(isHeartbeatTimedOut(1_000, 20_000)).toBe(true);
    expect(NETWORK_HEARTBEAT_TIMEOUT_MS).toBe(8_000);
  });

  it("does not turn invalid clock values into a false timeout", async () => {
    const { isHeartbeatTimedOut } = await import("../src/game/network-health");
    expect(isHeartbeatTimedOut(Number.NaN, 10_000)).toBe(false);
    expect(isHeartbeatTimedOut(1_000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
