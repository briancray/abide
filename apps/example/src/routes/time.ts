export function GET(): Response {
    return Response.json({ now: new Date().toISOString() })
}
