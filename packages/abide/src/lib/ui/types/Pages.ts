import type { UiComponent } from '../runtime/types/UiComponent.ts'

/*
Manifest of route URL → page.abide module loader. Produced by the resolver plugin
from `page.abide` files anywhere under src/ui/pages. `layout.abide` files form a
parallel manifest (see Layouts); there is no error manifest.
*/
export type Pages = Record<string, () => Promise<{ default: UiComponent }>>
