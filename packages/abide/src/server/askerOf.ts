// 44.7 — the caller's credentials, and nothing else of their request.
const CARRIED_HEADERS = ['cookie', 'authorization']

/** The asking request as a tool call is made: its credentials, and nothing else of it. 44.7. */
export function askerOf(asked: Request): Request {
    const carried: Record<string, string> = {}
    for (const name of CARRIED_HEADERS) {
        const value = asked.headers.get(name)
        if (value !== null) carried[name] = value
    }
    return new Request(asked.url, { headers: carried })
}
