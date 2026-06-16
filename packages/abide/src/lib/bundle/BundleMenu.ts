import type { BundleMenuItem } from './BundleMenuItem.ts'

/*
A top-level bundle menu, inserted into the macOS menu bar between the standard
Edit and Window menus. `label` titles the menu; `items` are its entries top to
bottom.
*/
// @readme bundle
export type BundleMenu = {
    label: string
    items: BundleMenuItem[]
}
