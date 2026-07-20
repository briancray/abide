// BundleMenu — a declarative native-menu tree (BU4).
//
// `label` names the menu (e.g. "File"); `items` are its entries. Single-level this slice; nested
// submenus are expressed by the platform shell rendering the items — the model stays flat.

import type { BundleMenuItem } from "./BundleMenuItem.ts";

export interface BundleMenu {
  label?: string;
  items: BundleMenuItem[];
}
