// BundleMenuItem — one entry in a native menu (BU4).
//
// A discriminated union of three shapes:
//   - a `separator` (a visual divider, no action);
//   - an `emit` item — fires a named app event routed to `onMenu(name, …)` handlers;
//   - a `navigate` item — goes straight to a route (no handler needed).
// `emit`/`navigate` items carry an optional platform `shortcut` (e.g. "Cmd+N").

export type BundleMenuItem =
  | { separator: true }
  | { label: string; emit: string; shortcut?: string }
  | { label: string; navigate: string; shortcut?: string };
