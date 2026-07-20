// BundleWindow — the one declarative window config for the desktop bundle (BU3).
//
// Authored once in `src/bundle/window.ts`. `title`/`width`/`height` describe the primary window
// (single window this slice; multi-window parked). `menu` is the native menu tree (BU4). `config`
// is an opaque bag reserved for platform-shell options — deliberately `unknown` so the shape can
// grow without a breaking change.

import type { BundleMenu } from "./BundleMenu.ts";

export interface BundleWindow {
  title?: string;
  width?: number;
  height?: number;
  menu?: BundleMenu;
  config?: unknown;
}
