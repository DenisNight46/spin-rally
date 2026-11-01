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
