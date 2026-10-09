let next = 4031

Bun.serve({
    routes: {
        // THE STATUS AND THE HEADER BESIDE THE BODY, in the one `Response`
        // the route builds — a helper that wanted to add a header would have
        // to be handed this object or return a partial one for it.
        '/api/addContact': async (request) => {
            const { name } = await request.json()
            const id = String(next)
            next += 1
            return Response.json(
                { id, name },
                { status: 201, headers: { location: `/contacts/${id}` } },
            )
        },
    },
})
