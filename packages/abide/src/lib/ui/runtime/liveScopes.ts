import type { Scope } from '../types/Scope.ts'

/*
Dev-only registry of every live scope, for the inspector's Reactive tab. `scopes`
stays empty and untouched unless installInspectorBridge flips `enabled` (gated by
the server-injected `__abideInspect`), so production allocates and tracks nothing.
createScope adds on construction and removes on dispose; the bridge reconstructs
the scope forest from each entry's `id` + `parent.id` (the Scope surface exposes
no children accessor, so the flat set + parent links is the traversal path). One
mutable singleton object — mirrors `reactiveAbortState`, reached without a barrel.
*/
export const liveScopes: { enabled: boolean; scopes: Set<Scope> } = {
    enabled: false,
    scopes: new Set(),
}
