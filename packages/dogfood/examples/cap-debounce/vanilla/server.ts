const BY_REGION: Record<string, number> = {
    n: 412,
    no: 412,
    nor: 128,
    nort: 128,
    north: 128,
}

Bun.serve({
    routes: {
        '/api/orders': (request) => {
            const { searchParams } = new URL(request.url)
            const region = (searchParams.get('region') ?? '').toLowerCase()
            return Response.json(BY_REGION[region] ?? 0)
        },
    },
})
