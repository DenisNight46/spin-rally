/** True when keyboard input should be left to an editable UI control. */
export function isTextEntryTarget(target: unknown): boolean {
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  } | null;
  const tagName = element?.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" ||
    element?.isContentEditable === true ||
    Boolean(element?.closest?.("[contenteditable='true']"));
}


/** Convert viewport coordinates to stable normalized device coordinates. */
export function normalizePointerPosition(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width) * 2 - 1)),
    y: Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height) * 2 - 1)),
  };
}
