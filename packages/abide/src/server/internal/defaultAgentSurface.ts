import type { AgentSurface } from './agentTypes.ts'
import type { AppConfig } from './appConfig.ts'
import { onRegistryRebind } from './registryDerivation.ts'

// The app-config DEFAULT tool surface for `agent()` — all `clients.mcp` RPCs (agent.md AG2.2, DX9).
//
// `clients.mcp` is already the gate. An agent's tool set IS the MCP tool set by definition (MS2.6), so
// an rpc reachable by MCP is reachable by an agent, and withholding it is `clients: { mcp: false }` —
// the same declaration, on the same surface, that every other machine client reads. Naming the tools
// per `agent()` call is the OVERRIDE (`tools: [...]` a subset, `tools: []` none), not the way in.
//
// This module is a LEAF on purpose. `agent()` is usable with no app config at all — a bare loop over an
// engine, no router, no registry — and it would stop being that if it imported `rpcTools`, which pulls
// `buildRegistry` and the whole `router` type graph behind it. So the arrow points the other way:
// `createApp` (which already holds the config, and already imports the registry) PROVIDES a thunk here,
// and `agent()` only asks. With nothing provided the answer is `[]`, which is exactly the documented
// no-app behaviour rather than a special case.
//
// A THUNK rather than a surface, because building it walks every route: a process that never calls
// `agent()` should not pay for the projection at boot. The result is memoised per provider, and dropped
// whenever the provider is — OR when the registry it was projected from is re-derived. That second
// clause is the fix for a premise this comment used to assert outright ("the registry cannot change once
// the app is built"): `abide dev` rebuilds the registry under a live provider, so the memo kept the first
// build's `doc`, input schemas and `clients.mcp` gate for the whole session. The provider thunk closes
// over the live `config`, so dropping the memo is the whole of the fix.
//
// Registration is a STACK, not a slot. One process serves one app in production, but `createTestApp`
// boots many, and a plain last-one-wins holder would leave a stopped app's tools answering for the next
// test. `provide` returns its own undo, which `App.stop()` calls, so the nesting is balanced and a
// stopped app never lingers as somebody else's default.
let provider: (() => AgentSurface) | undefined
let providerConfig: AppConfig | undefined
let cached: AgentSurface | undefined

// SCOPED TO THE CONFIG THE CURRENT PROVIDER PROJECTS, which is why `provide` takes one. A registry
// derivation must be a no-op for a config it holds nothing for — several apps share this process
// (`createTestApp` boots many, and test files run in parallel), so an unscoped `cached = undefined` here
// let ANY app's rebind drop a surface projected from a different app's registry. That is invisible in
// production, where one app rebinds once at boot, and shows up as a cross-file flake everywhere else.
onRegistryRebind((config) => {
    if (config === providerConfig) cached = undefined
})

// `config` is the registry `next` projects — the key the rebind invalidation above matches on, and the
// only reason this takes it. Omitted, the surface is simply never invalidated by a rebind, which is the
// right answer for a provider that closes over no registry at all.
export function provideDefaultAgentSurface(
    next: () => AgentSurface,
    config?: AppConfig,
): () => void {
    const previousProvider = provider
    const previousConfig = providerConfig
    const previousCached = cached
    provider = next
    providerConfig = config
    cached = undefined
    let undone = false
    return (): void => {
        // Idempotent: `stop()` may be called twice (a lifecycle backstop after an `onStop` that already
        // stopped), and the second call must not pop a frame it does not own.
        if (undone) return
        undone = true
        provider = previousProvider
        providerConfig = previousConfig
        cached = previousCached
    }
}

export function defaultAgentSurface(): AgentSurface {
    if (provider === undefined) return []
    if (cached === undefined) cached = provider()
    return cached
}
