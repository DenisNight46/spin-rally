import { describe, expect, it } from "vitest";
import { isTextEntryTarget } from "../contracts/input";

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
