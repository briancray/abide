const BY_YEAR: Record<string, { name: string; total: string }[]> = {
    '2026': [
        { name: 'north', total: '12480.00' },
        { name: 'south', total: '9140.00' },
        { name: 'east', total: '7020.00' },
    ],
}

function after(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

Bun.serve({
    routes: {
        // A CHUNK PER ROW, BY HAND: the header line first, then each row
        // encoded as the cursor reaches it rather than the file built whole.
        '/api/salesCsv': (request) => {
            const year = new URL(request.url).searchParams.get('year') ?? ''
            const rows = BY_YEAR[year] ?? []
            const encoder = new TextEncoder()
            let at = -1
            return new Response(
                new ReadableStream({
                    async pull(controller) {
                        if (at === -1) {
                            controller.enqueue(encoder.encode('region,total\n'))
                            at = 0
                            return
                        }
                        if (at === rows.length) return controller.close()
                        await after(300)
                        const row = rows[at]
                        controller.enqueue(
                            encoder.encode(`${row.name},${row.total}\n`),
                        )
                        at += 1
                    },
                }),
                { headers: { 'content-type': 'application/octet-stream' } },
            )
        },
    },
})
