// online() — a reactive connectivity boolean (CO2.5) for driving offline UI. On the client it
// tracks `navigator.onLine` through an M1 signal updated by the `online`/`offline` window events,
// so reading it inside a reactive context re-runs on connectivity change. On the server there is
// no browser connectivity notion, so it is always true.

import { signal, type Signal } from "./internal/reactive.ts";

const isBrowser = typeof globalThis !== "undefined" && typeof (globalThis as { window?: unknown }).window !== "undefined";

let onlineSignal: Signal<boolean> | undefined;

function ensureSignal(): Signal<boolean> {
  if (onlineSignal === undefined) {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    onlineSignal = signal(nav?.onLine ?? true);
    const win = globalThis as unknown as { addEventListener?: (type: string, handler: () => void) => void };
    win.addEventListener?.("online", () => onlineSignal!.set(true));
    win.addEventListener?.("offline", () => onlineSignal!.set(false));
  }
  return onlineSignal;
}

export function online(): boolean {
  if (!isBrowser) return true;
  return ensureSignal()();
}
