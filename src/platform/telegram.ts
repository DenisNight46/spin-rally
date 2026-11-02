type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => Promise<void> | void;
  exitFullscreen?: () => Promise<void> | void;
  isFullscreen?: boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
  contentSafeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const root = () => document.documentElement;

function syncTelegramViewport(webApp: TelegramWebApp): void {
  // viewportHeight follows Telegram's live viewport, including fullscreen transitions.
  // Stable height is only a fallback for older clients that omit viewportHeight.
  const height = webApp.viewportHeight || webApp.viewportStableHeight;
  if (height && Number.isFinite(height)) {
    root().style.setProperty("--tg-viewport-height", `${Math.round(height)}px`);
  }
  const safe = webApp.safeAreaInset;
  const content = webApp.contentSafeAreaInset;
  if (safe || content) {
    // Respect both device cutouts and Telegram's content-safe region.
    const inset = (edge: "top" | "right" | "bottom" | "left") =>
      Math.max(safe?.[edge] ?? 0, content?.[edge] ?? 0);
    root().style.setProperty("--tg-safe-top", `${inset("top")}px`);
    root().style.setProperty("--tg-safe-right", `${inset("right")}px`);
    root().style.setProperty("--tg-safe-bottom", `${inset("bottom")}px`);
    root().style.setProperty("--tg-safe-left", `${inset("left")}px`);
  }
}

/** Initializes Telegram's optional Mini App bridge; ordinary browser play stays unchanged. */
export function initializeTelegramMiniApp(): () => void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return () => {};

  webApp.ready();
  webApp.expand();
  webApp.setHeaderColor?.("#07151d");
  webApp.setBackgroundColor?.("#07151d");

  const sync = () => syncTelegramViewport(webApp);
  sync();
  webApp.onEvent?.("viewportChanged", sync);
  webApp.onEvent?.("safeAreaChanged", sync);

  return () => {
    webApp.offEvent?.("viewportChanged", sync);
    webApp.offEvent?.("safeAreaChanged", sync);
    for (const name of ["--tg-viewport-height", "--tg-safe-top", "--tg-safe-right", "--tg-safe-bottom", "--tg-safe-left"]) {
      root().style.removeProperty(name);
    }
  };
}
