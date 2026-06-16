import { abideUiPlugin } from '../../src/lib/ui/compile/abideUiPlugin.ts'
import { enterRenderPass } from '../../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../../src/lib/ui/runtime/exitRenderPass.ts'
import { nextBlockId } from '../../src/lib/ui/runtime/nextBlockId.ts'

/*
Test preload registering abide-ui's `.abide` loader so fixture pages/components
import and compile through the runtime the server and client bundles use. Replaces
the former Svelte preload — abide-ui is the only UI runtime now, and the reactive
test harnesses are plain `.ts` (abide-ui effect/derived), needing no loader.
*/
Bun.plugin(abideUiPlugin)

/*
Compiled SSR/client bodies run via `new Function` in the unit harnesses reference
the render-pass helpers as bare names (the real bundle imports them). Expose them
globally so those bodies resolve to the real runtime singleton — keeping the
block-id counter shared between a harness's server render and client mount.
*/
const globals = globalThis as Record<string, unknown>
globals.nextBlockId = nextBlockId
globals.enterRenderPass = enterRenderPass
globals.exitRenderPass = exitRenderPass
