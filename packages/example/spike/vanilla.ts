// The hand-written form of ONE remote read, which is what the machinery has to beat.
//
// The shape below is what someone actually writes, and the cost is not the line count — it is that
// the call is declared THREE times and nothing checks that the three agree: the handler, the route
// that exposes it, and the client stub that reaches it. Rename an argument and two of the three
// still compile.
//
// This file is never imported. It is the reference the spike is measured against.

// --- shared/users.ts ------------------------------------------------------- 3 lines
export function findUserByHand(id: number): { id: number; name: string } {
    return { id, name: `user ${id}` }
}

// --- server.ts ------------------------------------------------------------- 8 lines
// The route. Its path is a string that has to match the client's by hand.
export const VANILLA_ROUTES = {
    '/api/user': async (request: Request): Promise<Response> => {
        const { id } = (await request.json()) as { id: number }
        return Response.json(findUserByHand(id))
    },
}

// --- client.ts ------------------------------------------------------------- 9 lines
// A SEPARATE file, because importing the handler's module would drag the database driver into the
// browser bundle. That separation is the whole problem the elision seam exists to remove.
export async function getUserByHand(id: number): Promise<{ id: number; name: string }> {
    const response = await fetch('/api/user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
    })
    if (!response.ok) throw new Error(`getUser: ${response.status}`)
    return (await response.json()) as { id: number; name: string }
}

// 20 lines, three declarations, no cache. The caching half — dedupe two callers asking for the same
// id, retain the old value across a reload, tell pending from refreshing, drop a stale settle that
// lands after a newer one — is another ~40 lines by hand, and it is exactly what `memo` already is.
// That is the argument for `rpc = memo + transport`: the transport is the only new part.
