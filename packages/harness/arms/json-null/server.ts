const MANAGERS: Record<string, { name: string } | undefined> = {
    '4021': { name: 'Charles Babbage' },
    '4022': undefined,
}

Bun.serve({
    routes: {
        // `null` SPELLED OUT. Nothing to say is easiest answered with nothing,
        // and a caller reading the body as JSON then throws on an empty one.
        '/api/accountManager': (request) => {
            const id = new URL(request.url).searchParams.get('id') ?? ''
            return Response.json(MANAGERS[id] ?? null)
        },
    },
})
