// THE SCOPE-PROVIDED SPECIFIERS, and WHO SUPPLIES EACH.
//
// A framework specifier on this list must resolve through the injected `$scope` rather than a real
// module import: a component has to get the instance bound to THIS render (same scheduler, same
// request), not a fresh module instance. Being on the list means the emitters REFUSE to emit an
// import for it — `import { x } from 'abide/…'` becomes `const x = $scope["x"]`.
//
// So the list is a promise that something will put `x` in `$scope`, and it was making that promise for
// two names nobody kept. `abide/server/context` and `abide/server/server` were listed; neither the SSR
// scope nor the client scope assigned them. Both are documented public request-scope ambients, so
//
//     <script>import { context } from 'abide/server/context'
//     const c = context()</script>
//
// emitted `const context = $scope["context"]` and threw `context is not a function` on first render.
// The check lane copies the import verbatim, so `abide check` typed it perfectly. Three hand-written
// lists — this one and the two scopes — and no two of them had to agree.
//
// They agree now by construction. The table names each specifier's local binding AND which side
// supplies it, and `ServerScopeBindings`/`ClientScopeBindings` are derived from it — so a scope
// builder that omits an entry is a type error, and a specifier cannot be added here without saying who
// provides it. `navigate` is client-only and the four `abide/server/*` ambients are server-only; that
// asymmetry is data, not a special case.

export type ScopeProvidedSide = 'both' | 'server' | 'client'

export const SCOPE_PROVIDED = {
    'abide/shared/state': { local: 'state', side: 'both' },
    'abide/shared/watch': { local: 'watch', side: 'both' },
    'abide/ui/props': { local: 'props', side: 'both' },
    'abide/shared/route': { local: 'route', side: 'both' },
    'abide/shared/identity': { local: 'identity', side: 'both' },
    'abide/shared/url': { local: 'url', side: 'both' },
    'abide/ui/navigate': { local: 'navigate', side: 'client' },
    'abide/server/request': { local: 'request', side: 'server' },
    'abide/server/cookies': { local: 'cookies', side: 'server' },
    'abide/server/context': { local: 'context', side: 'server' },
    'abide/server/server': { local: 'server', side: 'server' },
} as const satisfies Record<string, { local: string; side: ScopeProvidedSide }>

type ScopeProvidedEntry = (typeof SCOPE_PROVIDED)[keyof typeof SCOPE_PROVIDED]

// The local names one side must put in `$scope`. `both` counts for each.
type LocalsOn<S extends 'server' | 'client'> = Extract<
    ScopeProvidedEntry,
    { side: S | 'both' }
>['local']

// What a scope builder owes. Annotate the framework half of a `$scope` with one of these and a name
// this table added — but that builder did not — is a compile error rather than a runtime `undefined`.
export type ServerScopeBindings = { [K in LocalsOn<'server'>]: unknown }
export type ClientScopeBindings = { [K in LocalsOn<'client'>]: unknown }

export const SCOPE_PROVIDED_SPECIFIERS: ReadonlySet<string> = new Set(Object.keys(SCOPE_PROVIDED))
