import { describe, expect, it } from "vitest";
import { getNationalTeam, NATIONAL_TEAMS } from "../src/game/teams";

describe("national team identity catalog", () => {
  it("contains a broad international starter roster with unique IDs", () => {
    expect(NATIONAL_TEAMS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(NATIONAL_TEAMS.map((team) => team.id)).size).toBe(NATIONAL_TEAMS.length);
    expect(NATIONAL_TEAMS.every((team) => /^[a-z]{3}$/.test(team.shortName))).toBe(true);
  });

  it("provides flag and original heraldic palette for every team", () => {
    for (const team of NATIONAL_TEAMS) {
      expect(team.flag.trim().length).toBeGreaterThan(0);
      expect(team.crest.initials.trim().length).toBeGreaterThan(0);
      expect(team.crest.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(team.crest.secondary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(team.crest.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("looks up teams by stable association ID", () => {
    expect(getNationalTeam("rus")?.name).toBe("Россия");
    expect(getNationalTeam("unknown")).toBeUndefined();
  });
});
