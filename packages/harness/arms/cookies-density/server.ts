// THE SERVER'S HALF IS A SECOND READER of the same cookie, written
// again against the request's header rather than `document.cookie`,
// so a reload paints what was picked rather than flashing the default.
const page = await Bun.file(new URL('./index.html', import.meta.url)).text()

Bun.serve({
    routes: {
        '/': (request) => {
            const jar = new Bun.CookieMap(request.headers.get('cookie') ?? '')
            const density = jar.get('density') ?? 'comfortable'
            const painted = page
                .replace(`data-density="${density}"`, `data-density="${density}" aria-selected="true"`)
                .replace('<strong id="density"></strong>', `<strong id="density">${density}</strong>`)
            return new Response(painted, {
                headers: { 'content-type': 'text/html' },
            })
        },
    },
})
