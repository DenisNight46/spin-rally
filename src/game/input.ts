import { isTextEntryTarget, normalizePointerPosition } from "@contracts/input";

export class Input {
  pointerX = 0;
  pointerY = 0;
  pointerStartX = 0;
  pointerStartY = 0;
  pointerFresh = false;
  pointerType: string | null = null;
  pointerActive = false;
  private pointerStartFresh = false;
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
    this.pointerStartFresh = false;
    this.pointerActive = false;
    this.pointerType = null;
    this.pointerFresh = false;
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.reset();
  }
}
