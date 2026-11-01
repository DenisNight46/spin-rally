type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
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
  const height = webApp.viewportStableHeight || webApp.viewportHeight;
  if (height && Number.isFinite(height)) {
    root().style.setProperty("--tg-viewport-height", `${Math.round(height)}px`);
  }
  const inset = webApp.safeAreaInset;
  if (inset) {
    root().style.setProperty("--tg-safe-top", `${inset.top ?? 0}px`);
    root().style.setProperty("--tg-safe-right", `${inset.right ?? 0}px`);
    root().style.setProperty("--tg-safe-bottom", `${inset.bottom ?? 0}px`);
    root().style.setProperty("--tg-safe-left", `${inset.left ?? 0}px`);
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
