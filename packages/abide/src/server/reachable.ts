// 23.10-23.13 — WHETHER A HOST ANSWERS AT ALL, asked before a call to it. A warm answer turns every
// call queued behind a host that is down into an instant refusal, where each would otherwise burn a
// network timeout of its own.
//
// ANY ANSWER IS REACHABLE: a 404 or a 500 came from the host, so only a request that never got one
// — refused, unresolved, timed out — is `false`. `HEAD`, so the answer carries no body to read.

import { reactive } from '#shared/reactive/index.ts'

const PROBE_TIMEOUT_MILLISECONDS = 5_000
const ANSWER_HELD_MILLISECONDS = 60_000

const answering = reactive(
    async ({ host }: { host: string }) => {
        try {
            await fetch(host.includes('://') ? host : `https://${host}/`, {
                method: 'HEAD',
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
            })
            return true
        } catch {
            return false
        }
    },
    { global: true, ttl: ANSWER_HELD_MILLISECONDS },
)

/** Whether `host` answers at all: a bare host over https, or an origin as written. */
export function reachable(host: string): Promise<boolean> {
    return Promise.resolve(answering({ host }))
}
