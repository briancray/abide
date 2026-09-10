let loads = 0

Bun.serve({
    routes: {
        '/api/stock': () => {
            loads += 1
            return Response.json({ onHand: 128, loads })
        },
    },
})
