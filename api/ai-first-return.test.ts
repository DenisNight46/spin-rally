import { describe, expect, it } from "vitest";
import { TableTennisSim } from "../contracts/sim";
import { TableTennisAI, type Difficulty } from "../src/game/ai";

describe("AI first-return regression", () => {
  it.each(["easy", "normal", "hard"] as const)(
    "%s bot returns the first received ball legally under varied incoming spin",
    (difficulty: Difficulty) => {
      const profiles = [
        { name: "flat", spin: { x: 0, y: 0, z: 0 } },
        { name: "topspin", spin: { x: 30, y: 0, z: 0 } },
        { name: "backspin", spin: { x: -30, y: 0, z: 0 } },
        { name: "sidespin", spin: { x: 0, y: 0, z: 26 } },
      ];

      for (const profile of profiles) {
        const sim = new TableTennisSim(419);
        const ai = new TableTennisAI(difficulty);
        sim.startMatch();
        sim.state.phase = "rally";
        sim.state.rallyHits = 1;
        sim.state.ball = {
          // A legal serve has already bounced once on the server's half.
          // The descending ball is now approaching its required receiver-side bounce.
          p: { x: 0.08, y: 0.88, z: -0.88 },
          v: { x: 0.18, y: -1.15, z: -3.2 },
          spin: { ...profile.spin },
          lastHitter: 0,
          bounces: 1,
          firstBounce: 0,
          serve: true,
        };

        let aiHit = false;
        let legalReturn = false;
        let lastEvent = sim.state.eventId;
        const trace: unknown[] = [];

        for (let frame = 0; frame < 720 && !legalReturn && sim.state.phase === "rally"; frame += 1) {
          ai.update(sim, 1 / 60);
          sim.step(1 / 120);
          sim.step(1 / 120);

          if (sim.state.eventId === lastEvent) continue;
          lastEvent = sim.state.eventId;
          const event = sim.state.event;
          if (event?.type === "hit" && event.side === 1) {
            aiHit = true;
            trace.push({ event, ball: structuredClone(sim.state.ball) });
          }
          if (event?.type === "bounce") {
            trace.push({ event, ball: structuredClone(sim.state.ball) });
            if (aiHit && event.p && event.p.z > 0) legalReturn = true;
          }
        }

        expect(aiHit, `${difficulty} missed the first ${profile.name} receive`).toBe(true);
        expect(
          legalReturn,
          `${difficulty} failed to return the first ${profile.name} receive; phase=${sim.state.phase}, message=${sim.state.message}, trace=${JSON.stringify(trace)}`,
        ).toBe(true);
        expect(sim.state.ball.lastHitter).toBe(1);
      }
    },
  );
});
