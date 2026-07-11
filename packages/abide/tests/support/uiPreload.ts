import { installAmbientScopeStore } from '../../src/lib/server/runtime/installAmbientScopeStore.ts'
import { abideUiPlugin } from '../../src/lib/ui/compile/abideUiPlugin.ts'
import { UI_RUNTIME_IMPORTS } from '../../src/lib/ui/compile/UI_RUNTIME_IMPORTS.ts'

/*
Test preload registering abide-ui's `.abide` loader so fixture pages/components
import and compile through the runtime the server and client bundles use. abide-ui
is the only UI runtime, and the reactive test harnesses are plain `.ts` (abide-ui
effect/computed), needing no loader.
*/
Bun.plugin(abideUiPlugin)

/* Install the production SSR render-path backing (ADR-0033 D1 AsyncLocalStorage) for ALL tests, so
   the path survives an async render's awaits exactly as it does under a booted server. Block ids are
   path-keyed (ADR-0037), so without this a miniDom harness's async SSR render would allocate ids
   under a stale/sync path — diverging from production AND from whichever test previously booted a
   real server (createServer installs the same backing). Idempotent; for synchronous client mounts
   the ALS `run` behaves like the sync save/restore it replaces, so congruence is unaffected. */
installAmbientScopeStore()

const globals = globalThis as Record<string, unknown>

/*
Compiled SSR/client bodies run via `new Function` in the unit harnesses reference the
runtime helpers by name — `$$`-prefixed in the real emit (`$$mountChild`, `$$skeleton`,
…), and by their bare name in the harnesses that inject one as a `new Function` param.
Publish EVERY `UI_RUNTIME_IMPORTS` helper under BOTH forms from its real module, so a
compiled body resolves to the one runtime singleton (keeping the block-id counter shared
between a harness's server render and client mount) and `withReserved`'s prelude — which
re-declares `var $$name = typeof name !== 'undefined' ? name : undefined`, shadowing the
global `$$name` — finds the bare global when a given harness doesn't inject that helper.

Derived entirely from the one import manifest so a new helper is covered with no edit
here (the drift the hand-maintained lists kept accruing). Three helpers publish under a
package subpath that no longer matches their file path (`scope`/`enterScope`/`exitScope`
→ `ui/currentScope`/`ui/enterRenderScope`/`ui/exitRenderScope`), so their real module path
is overridden.
*/
const REAL_PATH_OVERRIDE: Record<string, string> = {
    scope: 'ui/scope',
    enterScope: 'ui/enterScope',
    exitScope: 'ui/exitScope',
}
await Promise.all(
    UI_RUNTIME_IMPORTS.map(async (entry) => {
        const path = REAL_PATH_OVERRIDE[entry.name] ?? entry.specifier
        const module = (await import(`../../src/lib/${path}.ts`)) as Record<string, unknown>
        const value = module[entry.name]
        globals[entry.name] = value
        globals[entry.alias ?? entry.name] = value
    }),
)
