// THE HELD ANSWER IS A CACHE WRITTEN BY HAND: an entry per host, its
// age, and the probe in flight that the next ask has to join rather
// than send a second one beside.
const HELD_MILLISECONDS = 60_000
const PROBE_TIMEOUT_MILLISECONDS = 5_000

const BILLING = { origin: 'http://127.0.0.1:9' }

const answers = new Map<string, { at: number; answer: Promise<boolean> }>()

function reachable(host: string): Promise<boolean> {
    const held = answers.get(host)
    if (held !== undefined && Date.now() - held.at < HELD_MILLISECONDS)
        return held.answer
    const answer = fetch(host, {
        method: 'HEAD',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
    }).then(
        () => true,
        () => false,
    )
    answers.set(host, { at: Date.now(), answer })
    return answer
}

Bun.serve({
    routes: {
        '/api/sync': async (request) => {
            const id = new URL(request.url).searchParams.get('id') ?? ''
            const asked = performance.now()
            if (!(await reachable(BILLING.origin))) {
                const waited = Math.round(performance.now() - asked)
                return new Response(
                    `Billing is unreachable — refused in ${waited} ms.`,
                    { status: 503 },
                )
            }
            return fetch(`${BILLING.origin}/invoices/${id}`, { method: 'POST' })
        },
    },
})
