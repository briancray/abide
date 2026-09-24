const ROWS: Record<string, string[]> = {
    north: ['Oslo 412', 'Bergen 208', 'Tromsø 96'],
    south: [],
}

const STEP = 1_000

function after(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

Bun.serve({
    routes: {
        '/api/salesByRegion': (request) => {
            const region = new URL(request.url).searchParams.get('region') ?? ''
            const rows = ROWS[region] ?? []
            const encoder = new TextEncoder()
            let at = 0
            return new Response(
                new ReadableStream({
                    // A CALLER THAT GAVE UP ENDS THE PRODUCTION. Without this the
                    // reader is detached and the rows go on being made for nobody.
                    start(controller) {
                        request.signal.addEventListener('abort', () => {
                            try {
                                controller.error(request.signal.reason)
                            } catch {}
                        })
                    },
                    async pull(controller) {
                        // `south` yields nothing at all, which is the upstream that
                        // has stopped rather than the one that is merely slow.
                        if (at === rows.length) {
                            if (rows.length > 0) return controller.close()
                            return new Promise(() => {})
                        }
                        await after(STEP)
                        if (request.signal.aborted) return
                        controller.enqueue(encoder.encode(`${rows[at]}\n`))
                        at += 1
                    },
                }),
                { headers: { 'content-type': 'application/x-ndjson' } },
            )
        },
    },
})
