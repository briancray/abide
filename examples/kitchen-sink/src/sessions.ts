const sessions = new Map<string, { user: string }>()

export function createSession(user: string): string {
    const id = crypto.randomUUID()
    sessions.set(id, { user })
    return id
}

export function getSession(id: string | undefined): { user: string } | undefined {
    return id ? sessions.get(id) : undefined
}

export function destroySession(id: string | undefined): void {
    if (id) {
        sessions.delete(id)
    }
}

export const SESSION_COOKIE = 'sid'

export function readSessionCookie(req: Request): string | undefined {
    const cookie = req.headers.get('cookie') ?? ''
    const match = cookie.split(/;\s*/).find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : undefined
}
