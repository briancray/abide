import type { AgentSurface } from './agentTypes.ts'

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
// `agent()` should not pay for the projection at boot. The result is memoised per provider — the
// registry cannot change once the app is built — and the cache is dropped whenever the provider is.
//
// Registration is a STACK, not a slot. One process serves one app in production, but `createTestApp`
// boots many, and a plain last-one-wins holder would leave a stopped app's tools answering for the next
// test. `provide` returns its own undo, which `App.stop()` calls, so the nesting is balanced and a
// stopped app never lingers as somebody else's default.
let provider: (() => AgentSurface) | undefined
let cached: AgentSurface | undefined

export function provideDefaultAgentSurface(next: () => AgentSurface): () => void {
    const previousProvider = provider
    const previousCached = cached
    provider = next
    cached = undefined
    let undone = false
    return (): void => {
        // Idempotent: `stop()` may be called twice (a lifecycle backstop after an `onStop` that already
        // stopped), and the second call must not pop a frame it does not own.
        if (undone) return
        undone = true
        provider = previousProvider
        cached = previousCached
    }
}

export function defaultAgentSurface(): AgentSurface {
    if (provider === undefined) return []
    if (cached === undefined) cached = provider()
    return cached
}
