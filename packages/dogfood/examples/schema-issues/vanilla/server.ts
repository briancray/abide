const INVOICES = ['INV-4310', 'INV-4311', 'INV-4312']

const LIMIT = 3

// THE ISSUES, KEYED BY HAND. Each key is a field's path spelled as a
// string, so a typo here is a message the form looks up and never
// finds — and the field it belonged to renders clean.
function issuesFor(query: string, limit: number): Record<string, string[]> {
    const issues: Record<string, string[]> = {}
    if (query.length < 2) issues.query = ['Type at least two characters.']
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT)
        issues.limit = ['Between 1 and 3.']
    return issues
}

Bun.serve({
    routes: {
        '/api/searchInvoices': (request) => {
            const { searchParams } = new URL(request.url)
            const query = searchParams.get('query') ?? ''
            const limit = Number(searchParams.get('limit') ?? '20')
            const issues = issuesFor(query, limit)
            if (Object.keys(issues).length > 0) {
                return Response.json(
                    {
                        name: 'ValidationError',
                        status: 422,
                        message: 'Those arguments were refused.',
                        data: issues,
                    },
                    { status: 422 },
                )
            }
            const word = query.toLowerCase()
            const matched = INVOICES.filter((one) =>
                one.toLowerCase().includes(word),
            )
            return Response.json(matched.slice(0, limit))
        },
    },
})
