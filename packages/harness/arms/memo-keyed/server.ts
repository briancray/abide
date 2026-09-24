const PEOPLE = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper']

Bun.serve({
    routes: {
        '/api/search': (request) => {
            const { searchParams } = new URL(request.url)
            const word = (searchParams.get('query') ?? '').toLowerCase()
            const found = PEOPLE.filter((one) => {
                return one.toLowerCase().includes(word)
            })
            return Response.json(found)
        },
    },
})
