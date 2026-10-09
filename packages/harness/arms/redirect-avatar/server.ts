const CONTACTS: Record<
    string,
    { initials: string; color: string; photoVersion: number }
> = {
    '4021': { initials: 'AL', color: '#2f8f83', photoVersion: 3 },
    '4022': { initials: 'GH', color: '#c4693d', photoVersion: 7 },
}

Bun.serve({
    routes: {
        '/api/photo': (request) => {
            const query = new URL(request.url).searchParams
            const contact = CONTACTS[query.get('id') ?? '']
            if (!contact) return new Response('Not found', { status: 404 })
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${contact.color}"/><text x="48" y="58" font-family="sans-serif" font-size="32" font-weight="600" fill="#fff" text-anchor="middle">${contact.initials}</text><text x="48" y="84" font-family="monospace" font-size="10" fill="#fff" fill-opacity=".7" text-anchor="middle">v${query.get('version')}</text></svg>`
            return new Response(svg, {
                headers: { 'content-type': 'image/svg+xml' },
            })
        },
        // THE DESTINATION, SPELLED OUT: the photo route's address and its
        // query are written here a second time, checked against nothing.
        '/api/avatar': (request) => {
            const id = new URL(request.url).searchParams.get('id') ?? ''
            const contact = CONTACTS[id]
            if (!contact) return new Response('Not found', { status: 404 })
            const to = `/api/photo?id=${id}&version=${contact.photoVersion}`
            return new Response(null, {
                status: 302,
                headers: { location: to },
            })
        },
    },
})
