// emitMenu(name) — fire a named menu event into the `onMenu` sink (BU4).
//
// The launcher / native shell calls this when a menu `emit` item is chosen. It's the producer side
// of the registry that `onMenu` consumes: dispatch runs every handler registered for `name` plus
// every all-emits handler.

import { dispatchMenu } from "./internal/menuRegistry.ts";

export function emitMenu(name: string): void {
  dispatchMenu(name);
}
