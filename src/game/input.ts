const KEYS: Record<string, ["x" | "z", number]> = {
  KeyA: ["x", -1], ArrowLeft: ["x", -1],
  KeyD: ["x", 1], ArrowRight: ["x", 1],
  KeyW: ["z", 1], ArrowUp: ["z", 1],
  KeyS: ["z", -1], ArrowDown: ["z", -1],
};

export class Input {
  x = 0;
  z = 0;
  pointerX = 0;
  pointerY = 0;
  pointerFresh = false;
  private pointerPressed = false;
  readonly actions = new Set<string>();
  private held = new Set<string>();
  private activePointer: number | null = null;
  private listeners: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement) {
    const on = <T extends Event>(target: Window | HTMLElement, type: string, fn: (event: T) => void, options?: AddEventListenerOptions) => {
      const handler = fn as EventListener;
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    };
    on<KeyboardEvent>(window, "keydown", (event) => {
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
    on<PointerEvent>(canvas, "pointerdown", (event) => {
      // Only the primary pointer controls the racket; secondary touches must not
      // teleport it or accidentally trigger a serve.
      if (event.button !== 0 || (this.activePointer !== null && this.activePointer !== event.pointerId)) return;
      this.activePointer = event.pointerId;
      this.pointerPressed = true;
      canvas.setPointerCapture?.(event.pointerId);
      this.updatePointer(event);
    });
    on<PointerEvent>(canvas, "pointermove", (event) => {
      if (event.pointerType === "mouse" || this.activePointer === event.pointerId) this.updatePointer(event);
    });
    const release = (event: PointerEvent) => {
      if (this.activePointer === event.pointerId) this.activePointer = null;
    };
    on<PointerEvent>(canvas, "pointerup", release);
    on<PointerEvent>(canvas, "pointercancel", release);
    on<PointerEvent>(canvas, "contextmenu", (event) => event.preventDefault());
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    this.pointerFresh = true;
  }

  private recompute(): void {
    this.x = 0;
    this.z = 0;
    for (const code of this.held) {
      const key = KEYS[code];
      if (key) this[key[0]] += key[1];
    }
    this.x = Math.max(-1, Math.min(1, this.x));
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

  reset(): void {
    this.held.clear();
    this.actions.clear();
    this.activePointer = null;
    this.pointerPressed = false;
    this.pointerFresh = false;
    this.recompute();
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.reset();
  }
}
