// The SERVER-side source `health()` composes its document from (CO2.4) — the bind clock and the app's
// `onHealth` hook, neither of which `shared/` may name.
//
// `health()` is isomorphic and lives in `shared/`, so it cannot import `server/internal/router.ts` to
// reach `config.onHealth`. The arrow points the other way, exactly as `defaultAgentSurface` does for
// `agent()`: whoever binds the app PROVIDES what it knows here, and `health()` only asks. With nothing
// provided the answer is the framework baseline off `performance.timeOrigin` — the documented
// no-app behaviour (a bare script, a test importing the primitive) rather than a special case.
//
// NOT on the reactive scope, which is where `identity`/`route`/`traceparent` live: the admission rule
// there is "exactly this scope's lifetime", and an app's health hook has the APP's lifetime, not one
// request's. The hook is request-SCOPED when the route calls it (it reads `identity()`), but it is not
// request-OWNED.
//
// Registration is a STACK, not a slot, for the same reason `defaultAgentSurface`'s is: one process
// serves one app in production, but `createTestApp` boots many, and a last-one-wins holder would leave
// a stopped app's `onHealth` answering for the next test. `provide` returns its own undo, which
// `App.stop()` calls, so the nesting is balanced.

export interface HealthSource {
    // Epoch ms the app came up — the router's BIND time, which is what `uptime` measures.
    startedAt: number
    // The app's `onHealth` hook, if it exports one. Returns the fields merged over the baseline.
    onHealth?: (() => unknown | Promise<unknown>) | undefined
}

let current: HealthSource | undefined

export function provideHealthSource(next: HealthSource): () => void {
    const previous = current
    current = next
    let undone = false
    return (): void => {
        // Idempotent: `stop()` may be called twice (a lifecycle backstop after an `onStop` that already
        // stopped), and the second call must not pop a frame it does not own.
        if (undone) return
        undone = true
        current = previous
    }
}

export function healthSource(): HealthSource | undefined {
    return current
}
