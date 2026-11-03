import { isTextEntryTarget, normalizePointerPosition } from "@contracts/input";

const KEYS: Record<string, ["x" | "y" | "z", number]> = {
  KeyA: ["x", -1], ArrowLeft: ["x", -1],
  KeyD: ["x", 1], ArrowRight: ["x", 1],
  KeyW: ["y", 1], ArrowUp: ["y", 1],
  KeyS: ["y", -1], ArrowDown: ["y", -1],
  KeyQ: ["z", -1],
  KeyE: ["z", 1],
};

export class Input {
  x = 0;
  y = 0;
  z = 0;
  pointerX = 0;
  pointerY = 0;
  pointerStartX = 0;
  pointerStartY = 0;
  pointerFresh = false;
  pointerType: string | null = null;
  pointerActive = false;
  private pointerStartFresh = false;
  private pointerPressed = false;
  readonly actions = new Set<string>();
  private held = new Set<string>();
  private activePointer: number | null = null;
  private listeners: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement) {
    const on = <T extends Event>(target: EventTarget, type: string, fn: (event: T) => void, options?: AddEventListenerOptions) => {
      const handler = fn as EventListener;
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    };
    on<KeyboardEvent>(window, "keydown", (event) => {
      if (isTextEntryTarget(event.target)) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
      if (!event.repeat) this.actions.add(event.code);
      this.held.add(event.code);
      this.recompute();
    });
    on<KeyboardEvent>(window, "keyup", (event) => {
      this.held.delete(event.code);
      this.recompute();
    });
    on(window, "blur", () => this.reset());
    on(window, "pagehide", () => this.reset());
    on(document, "visibilitychange", () => { if (document.hidden) this.reset(); });
    on<PointerEvent>(canvas, "pointerdown", (event) => {
      // Only the primary pointer controls the racket; secondary touches must not
      // teleport it or accidentally trigger a serve.
      if (event.button !== 0 || !event.isPrimary || (this.activePointer !== null && this.activePointer !== event.pointerId)) return;
      this.activePointer = event.pointerId;
      this.pointerActive = true;
      this.pointerType = event.pointerType;
      this.pointerStartFresh = true;
      this.pointerPressed = true;
      canvas.setPointerCapture?.(event.pointerId);
      this.updatePointer(event);
      this.pointerStartX = this.pointerX;
      this.pointerStartY = this.pointerY;
    });
    on<PointerEvent>(canvas, "pointermove", (event) => {
      if ((this.activePointer === null && event.pointerType === "mouse") || this.activePointer === event.pointerId) this.updatePointer(event);
    });
    const release = (event: PointerEvent, canceled = false) => {
      if (this.activePointer !== event.pointerId) return;
      this.activePointer = null;
      this.pointerActive = false;
      if (canceled) {
        this.pointerStartFresh = false;
        this.pointerFresh = false;
        this.pointerPressed = false;
      }
    };
    on<PointerEvent>(canvas, "pointerup", (event) => release(event));
    on<PointerEvent>(canvas, "pointercancel", (event) => release(event, true));
    on<PointerEvent>(canvas, "lostpointercapture", (event) => release(event, true));
    on<PointerEvent>(canvas, "contextmenu", (event) => event.preventDefault());
  }

  private updatePointer(event: PointerEvent): void {
    const point = normalizePointerPosition(event.clientX, event.clientY, this.canvas.getBoundingClientRect());
    if (!point) return;
    this.pointerX = point.x;
    this.pointerY = point.y;
    this.pointerType = event.pointerType;
    this.pointerFresh = true;
  }

  private recompute(): void {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    for (const code of this.held) {
      const key = KEYS[code];
      if (key?.[0] === "x") this.x += key[1];
      if (key?.[0] === "y") this.y += key[1];
      if (key?.[0] === "z") this.z += key[1];
    }
    this.x = Math.max(-1, Math.min(1, this.x));
    this.y = Math.max(-1, Math.min(1, this.y));
    this.z = Math.max(-1, Math.min(1, this.z));
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  consume(code: string): boolean {
    const value = this.actions.has(code);
    this.actions.delete(code);
    return value;
  }

  requestServe(): void {
    this.actions.add("Space");
  }

  consumePointerPress(): boolean {
    const pressed = this.pointerPressed;
    this.pointerPressed = false;
    return pressed;
  }

  consumePointerStart(): boolean {
    const started = this.pointerStartFresh;
    this.pointerStartFresh = false;
    return started;
  }

  reset(): void {
    if (this.activePointer !== null && this.canvas.hasPointerCapture?.(this.activePointer)) {
      this.canvas.releasePointerCapture?.(this.activePointer);
    }
    this.held.clear();
    this.actions.clear();
    this.activePointer = null;
    this.pointerPressed = false;
    this.pointerStartFresh = false;
    this.pointerActive = false;
    this.pointerType = null;
    this.pointerFresh = false;
    this.recompute();
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.reset();
  }
}
