# abide — Desktop Bundle (Spec, Slice 7)

Status: draft, derived from design interview 2026-07-17.
Scope: `abide bundle` — the abide app as a native desktop window. The last distinct surface.
Builds on MS3 (dual-mode binary), AU9 (sealed-identity bearer), CO1 (config schema).

Through-line: **"your app's UI in a native window with a native menu"** — not a full native-API
framework. Dual-mode (remote or self-host) like the CLI, and self-configuring on first run.

---

## BU1. Architecture — dual-mode, system webview

1. **The bundle = the abide app's UI in a native window, dual-mode like the CLI (MS3):**
   - **`ABIDE_APP_URL` set → the webview loads that remote deployment** (thin client),
     authenticating with `ABIDE_APP_TOKEN` (sealed-identity bearer, AU9);
   - **no URL → self-host** (embeds the app, boots a local server, webview points at it).
2. **System webview, not bundled Chromium** — WebKit (macOS) / WebView2 (Windows) / WebKitGTK
   (Linux) via a small Bun-hosted native shell (Tauri-style). Keeps bundles small; the host
   process is Bun.
3. **`abide bundle` builds for the *host platform only*** — no cross-compilation (native shells
   need platform toolchains), unlike `abide cli --platforms`.

## BU2. First-run setup screen

When launched **unconfigured** (no `ABIDE_APP_URL`), the bundle presents a built-in setup
screen offering either:
- **(a)** a field to **enter a remote app URL** to connect to, or
- **(b)** a **schema-driven form of the app's config vars** (from `env(schema)`, CO1) to
  configure and **start the local embedded server**.

The form is generated from the **config schema** (CO1.3, type-derived) — the same schema→form
generation as client validation (§10/§12). So the config schema now feeds **boot validation
*and* the bundle setup form** ("one schema story").

## BU3. Window

- **`src/bundle/window.ts` = one declarative `BundleWindow`** (`title`, `width`, `height`,
  `menu`, `config`). **Single primary window this slice; multi-window parked.**

## BU4. Native menu

- **`BundleMenu`** = a declarative tree (`label`, `items`).
- **`BundleMenuItem`** = a union:
  - **`separator`**;
  - **`emit`** — fires a named event, handled by **`onMenu(name, handler)`** (or
    `onMenu(handler)` for all);
  - **`navigate`** — goes to a route directly (no handler);
  - each with an optional **`shortcut`**.
- So menu items either **emit app events** (→ `onMenu` sink) or **navigate** (→ route). `onMenu`
  is the emit sink.

## BU5. Runtime probe

- **`bundled()` → boolean**, imported from **`abide/ui/bundled`** (the UI layer, moved from
  `abide/bundle/bundled`) — a client-runtime check ("am I inside the desktop bundle?") for
  conditionally rendering native-only affordances.

## BU6. Native surface — minimal

- **Window + menu only** this slice. **Parked:** file dialogs, notifications, tray, deep links,
  multi-window, auto-update. The bundle is "your app in a native window with a native menu," not
  a native-API framework.

---

## Deferred / parked (rule before implementation)

- **Multi-window** (BU3), **additional native APIs** — dialogs/notifications/tray/deep-links/
  auto-update (BU6).
- **Bundle code-signing / notarization / installer packaging** per platform — not specced.
- **Cross-platform bundling** (BU1.3 is host-only).
