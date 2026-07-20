import { GET } from 'abide/server/GET'

// A SHARED read: its cache slot lives in the process-global shared store (not the per-request
// context), so the handler runs ONCE and every later request — any tab, any identity — is served
// the same retained value. `runs` counts real handler executions, so two separate HTTP requests
// (two `raw()` fetches) return the SAME count: proof of the cross-request cache. A shared handler is
// identity-independent and fail-closed — it runs scope-exited, so touching request scope would throw.
let runs = 0

export default GET(
    ({ tag = 's' }: { tag?: string }) => {
        runs++
        return { tag, runs }
    },
    { cache: { shared: true } },
)
