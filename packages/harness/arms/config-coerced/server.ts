// THE COERCION, BY HAND, at the read. The environment holds text, so a
// read that forgets `Number` hands the page "5" and the page adds "51".
const DEFAULT_RETRIES = 3

function retries(): number {
    const parsed = Number(process.env.RETRIES ?? Number.NaN)
    return Number.isFinite(parsed) ? parsed : DEFAULT_RETRIES
}

Bun.serve({
    routes: {
        '/api/retryPolicy': () => Response.json({ retries: retries() }),
    },
})
