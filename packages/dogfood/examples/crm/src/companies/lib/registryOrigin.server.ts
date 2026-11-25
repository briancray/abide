let origin: string | undefined

// How many times the registry has been asked about each company.
const asked = new Map<string, number>()

/** How many times the registry has been asked about the company `id`. */
export function registryAsked(id: string): number {
    return asked.get(id) ?? 0
}

/**
 * The registry on a bad day: Hopper & Co answers every third ask, Babbage Labs is not on it, Turing
 * Trust answers after two seconds, and Noether Group answers once and then never again.
 */
export function registryOrigin(): string {
    if (origin === undefined) {
        const registry = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            async fetch(request) {
                const id = new URL(request.url).pathname.split('/').pop() ?? ''
                const count = registryAsked(id) + 1
                asked.set(id, count)
                const busy =
                    id === 'langley-research' ||
                    (id === 'hopper-and-co' && count % 3 !== 0) ||
                    (id === 'noether-group' && count > 1)
                if (busy) return new Response('busy', { status: 503 })
                if (id === 'babbage-labs')
                    return new Response('no such company', { status: 404 })
                if (id === 'turing-trust') await Bun.sleep(2_000)
                return Response.json({ founded: 1906, employees: 140 })
            },
        })
        registry.unref()
        origin = registry.url.origin
    }
    return origin
}
