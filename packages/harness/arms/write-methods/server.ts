const DEFAULT_TAGS = ['customer', 'newsletter', 'vip']

const contact = {
    name: 'Ada Lovelace',
    phone: '020 7946 0018',
    tags: [...DEFAULT_TAGS],
}

Bun.serve({
    routes: {
        // A METHOD PER WRITE, each one a key here and a string in the page
        // that has to match it; a `DELETE` reads its arguments off the URL.
        '/api/contact': {
            GET: () => Response.json(contact),
            PATCH: async (request) => {
                const { phone } = await request.json()
                contact.phone = phone
                return Response.json(contact)
            },
            PUT: async (request) => {
                const { tags } = await request.json()
                contact.tags = tags
                return Response.json(contact)
            },
            DELETE: (request) => {
                const tag = new URL(request.url).searchParams.get('tag')
                contact.tags = contact.tags.filter((each) => each !== tag)
                return Response.json(contact)
            },
        },
    },
})
