import { describe, expect, it } from "vitest";
import { isTextEntryTarget, normalizePointerPosition } from "../contracts/input";

function target(overrides: Record<string, unknown>): unknown {
  return overrides;
}

describe("keyboard focus guard", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT"])("ignores %s controls", (tagName) => {
    expect(isTextEntryTarget(target({ tagName }))).toBe(true);
  });

  it("ignores contenteditable elements and their descendants", () => {
    expect(isTextEntryTarget(target({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(isTextEntryTarget(target({
      tagName: "SPAN",
      closest: (selector: string) => selector === "[contenteditable='true']" ? {} : null,
    }))).toBe(true);
  });

  it("keeps ordinary game surfaces eligible for shortcuts", () => {
    expect(isTextEntryTarget(target({ tagName: "CANVAS" }))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});


describe("pointer coordinate mapping", () => {
  it("maps the center and corners of the viewport to normalized coordinates", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(normalizePointerPosition(300, 150, rect)).toEqual({ x: 0, y: 0 });
    expect(normalizePointerPosition(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(normalizePointerPosition(500, 250, rect)).toEqual({ x: 1, y: -1 });
  });

  it("clamps captured pointer movement outside the canvas", () => {
    expect(normalizePointerPosition(700, -50, { left: 100, top: 50, width: 400, height: 200 }))
      .toEqual({ x: 1, y: 1 });
  });

  it("maps an upward finger movement to an upward world-space ray", () => {
    const rect = { left: 0, top: 0, width: 390, height: 844 };
    const lower = normalizePointerPosition(195, 600, rect);
    const upper = normalizePointerPosition(195, 400, rect);
    expect(upper!.y).toBeGreaterThan(lower!.y);
  });

  it("rejects zero-sized and non-finite viewport geometry", () => {
    expect(normalizePointerPosition(1, 1, { left: 0, top: 0, width: 0, height: 100 })).toBeNull();
    expect(normalizePointerPosition(Number.NaN, 1, { left: 0, top: 0, width: 100, height: 100 })).toBeNull();
  });
});
