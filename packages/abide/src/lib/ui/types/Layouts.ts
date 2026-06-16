import type { UiComponent } from '../runtime/types/UiComponent.ts'

/*
Manifest of directory URL → layout.abide module loader. Produced by the resolver
plugin from `layout.abide` files anywhere under src/ui/pages. A layout's key is its
folder path, so it wraps every page at or below that folder; the renderer and router
resolve a route's chain (outermost first) via layoutChainForRoute.
*/
export type Layouts = Record<string, () => Promise<{ default: UiComponent }>>
