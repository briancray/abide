const BY_DAY: Record<string, object[]> = {
    '2026-10-07': [
        { region: 'north', orders: 41, total: 12480 },
        { region: 'south', orders: 29, total: 9140 },
        { region: 'east', orders: 22, total: 7020 },
    ],
}

Bun.serve({
    routes: {
        // ONE VALUE PER LINE, BY HAND, and a trailing newline so the last
        // line is a whole one to a reader splitting on them.
        '/api/salesForWarehouse': (request) => {
            const day = new URL(request.url).searchParams.get('day') ?? ''
            let lines = ''
            for (const sale of BY_DAY[day] ?? [])
                lines += `${JSON.stringify(sale)}\n`
            return new Response(lines, {
                headers: { 'content-type': 'application/jsonl' },
            })
        },
    },
})
