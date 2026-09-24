const onHand: Record<string, number> = { east: 128, west: 64 }
const loads: Record<string, number> = { east: 0, west: 0 }

Bun.serve({
    routes: {
        '/api/stock': (request) => {
            const { searchParams } = new URL(request.url)
            const warehouse = searchParams.get('warehouse') ?? 'east'
            loads[warehouse] = (loads[warehouse] ?? 0) + 1
            return Response.json({
                onHand: onHand[warehouse] ?? 0,
                loads: loads[warehouse] ?? 0,
            })
        },
        '/api/book': () => {
            onHand.east -= 1
            return Response.json({ onHand: onHand.east })
        },
    },
})
