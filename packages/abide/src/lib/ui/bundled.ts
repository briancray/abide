// bundled() — the desktop-bundle runtime probe (BU5).
//
// Answers "am I running inside the abide desktop bundle?" so app code can conditionally render
// native-only affordances (menu-driven flows, window chrome) that only make sense in the bundle.
// Lives in `abide/ui` (the UI layer) rather than `abide/bundle` so a page can import it without
// pulling in the launcher/build machinery.
//
// The launcher sets a marker before loading the app UI: either the `globalThis.__ABIDE_BUNDLED__`
// flag (injected into the webview) or the `ABIDE_BUNDLED=1` env var (the self-hosting server
// process). Either one flips the probe on. Absent both — a plain browser tab or a bare server — it
// returns false.

export function bundled(): boolean {
  if ((globalThis as { __ABIDE_BUNDLED__?: unknown }).__ABIDE_BUNDLED__ === true) return true;
  if (typeof Bun !== "undefined" && Bun.env.ABIDE_BUNDLED === "1") return true;
  return false;
}
