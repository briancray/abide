import type { BrowserContext } from '@playwright/test'
import { LAYERS_ARMED } from '../../abide/src/ui/LAYER_NAMES.ts'

/**
 * Arms abide's layer measures in every page the context opens.
 *
 * ARMED BEFORE ABIDE'S MODULE GRAPH LOADS. `measureLayer.ts` reads the flag once into a `const` so
 * the disarmed path is one foldable branch rather than a global read per op — which means an init
 * script and a navigation, not `page.evaluate` after load.
 */
export async function armLayers(context: BrowserContext): Promise<void> {
    // The name is an ARGUMENT: an init script is serialized, so a closed-over constant is gone.
    await context.addInitScript((flag) => {
        ;(globalThis as unknown as Record<string, boolean>)[flag] = true
    }, LAYERS_ARMED)
}
