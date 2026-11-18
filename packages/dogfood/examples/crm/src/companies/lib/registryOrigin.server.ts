let origin: string | undefined

// How many times the registry has been asked about each company.
const asked = new Map<string, number>()

/** How many times the registry has been asked about the company `id`. */
export function registryAsked(id: string): number {
    return asked.get(id) ?? 0
}

/** The registry on a bad day: Hopper & Co answers every third ask. */
export function registryOrigin(): string {
    if (origin === undefined) {
        const registry = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request) {
                const id = new URL(request.url).pathname.split('/').pop() ?? ''
                const count = registryAsked(id) + 1
                asked.set(id, count)
                const busy =
                    id === 'langley-research' ||
                    (id === 'hopper-and-co' && count % 3 !== 0)
                if (busy) return new Response('busy', { status: 503 })
                return Response.json({ founded: 1906, employees: 140 })
            },
        })
        registry.unref()
        origin = registry.url.origin
    }
    return origin
}
