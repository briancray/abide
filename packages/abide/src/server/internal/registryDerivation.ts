import type { AppConfig } from './appConfig.ts'

// DERIVED-FROM-THE-REGISTRY: state computed from `config` once at boot rather than per request — the
// per-route CORS policy, the composed middleware chain, the page-pattern list, the client bundle, the
// agent tool surface. Cheap and correct for a served app, and a trap for `abide dev`, which reloads by
// REASSIGNING `config`'s properties on a LIVE router. Dispatch reads the registry live, so the premise
// "reassigning is picked up" holds for handlers and silently fails for everything derived from them.
//
// This module exists because the rule "anything derived from the registry is re-derived by
// `App.rebind()`" was PROSE, and prose does not hold. Three derivations were inside `bindRoutes`; two
// were not and had no invalidation at all:
//
//   - `navRoute`'s `PAGE_PATTERNS`, a WeakMap keyed on the `AppConfig` OBJECT, while the dev rebuild
//     reassigns `config.pages` on that same object. Its comment claimed "a dev-server config swap simply
//     re-derives" — describing a swap the dev server does not perform. A page added under `abide dev` was
//     never matched (404 until restart) and a deleted one still matched, reaching the branch `navRoute`
//     labels "Unreachable".
//   - `defaultAgentSurface`'s `cached`, memoised on first call and dropped only with the provider, so
//     `agent()`'s tool list kept the first build's `doc`, input schemas and `clients.mcp` gate.
//
// A third, `clientBundle`'s `BUNDLE_CACHE`, was correct only by convention: a SECOND exported hook that
// the dev loop remembered to call from `cli/`. Correct-by-convention is the state the other two were in
// before they weren't.
//
// So invalidation is REGISTERED rather than remembered. A derivation names itself here at module load;
// `App.rebind()` runs every one. The property that matters is that you cannot add a config-keyed cache
// and forget the dev lane — there is one call, it is not per-derivation, and the failure it prevents is
// invisible at the point of failure (dev-only, silent, per-request).
//
// Registration is at MODULE level, not per app: the caches these invalidate are module-level too, and a
// process serving two apps (`createTestApp` boots many) invalidates by config, which is the key each
// cache already uses. An invalidator must therefore be a no-op for a config it holds nothing for —
// `Map.delete` of an absent key, which is what all three are.
type RegistryDerivation = (config: AppConfig) => void

const DERIVATIONS: RegistryDerivation[] = []

// Declare a value as derived from the registry. `invalidate` drops whatever this module cached for
// `config`; the next read re-derives lazily. Called at module load, so a derivation is registered
// whether or not the app ever rebinds.
export function onRegistryRebind(invalidate: RegistryDerivation): void {
    DERIVATIONS.push(invalidate)
}

// Every registered derivation, for this config. `App.rebind()` calls this; nothing else should.
export function rebindRegistryDerivations(config: AppConfig): void {
    for (let index = 0; index < DERIVATIONS.length; index += 1) DERIVATIONS[index]?.(config)
}

// How many derivations are registered. Exported for `registryDerivation.test.ts`, which asserts the
// count is exactly the set this module's header enumerates — so a new config-keyed cache that registers
// itself is noticed by the test that names them, and one that does NOT register cannot be added without
// the dev-lane test below failing on its behalf.
export function registeredDerivationCount(): number {
    return DERIVATIONS.length
}
