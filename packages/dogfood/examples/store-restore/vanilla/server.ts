const settings: Record<string, unknown> = {}

Bun.serve({
    routes: {
        '/api/setting': async (request) => {
            if (request.method === 'POST') {
                const body = await request.json()
                settings[body.name] = body.value
                return Response.json(settings[body.name] ?? null)
            }
            const { searchParams } = new URL(request.url)
            const name = searchParams.get('name') ?? ''
            return Response.json(settings[name] ?? null)
        },
    },
})
