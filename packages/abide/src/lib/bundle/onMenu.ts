// onMenu(...) — subscribe to native-menu `emit` events (BU4).
//
// Two forms:
//   - `onMenu(name, handler)` — fire `handler` when the menu emits exactly `name`;
//   - `onMenu(handler)` — fire `handler` on every menu emit (a catch-all sink).
// Returns an unsubscribe function. The native shell / launcher drives the other side by calling
// `emitMenu(name)` when a menu item is chosen.

import { registerAll, registerNamed, type MenuHandler } from "./internal/menuRegistry.ts";

export function onMenu(name: string, handler: MenuHandler): () => void;
export function onMenu(handler: MenuHandler): () => void;
export function onMenu(nameOrHandler: string | MenuHandler, handler?: MenuHandler): () => void {
  if (typeof nameOrHandler === "string") {
    if (handler === undefined) throw new TypeError("onMenu(name, handler): handler is required");
    return registerNamed(nameOrHandler, handler);
  }
  return registerAll(nameOrHandler);
}
