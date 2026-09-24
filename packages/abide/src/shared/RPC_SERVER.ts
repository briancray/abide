// WHAT AN `Rpc` ASKS OF THE SERVER IT RUNS ON, as slots the server fills (`#server/requestScope.ts`,
// `#server/createApp.ts`, `#server/answerRequest.ts`): the request a rung is handed (16.12), the app
// a `raw` call is answered by in process (16.44), and where a call reports the value it reached, so
// a page's render can leave it for the browser's own call (41.13). A leaf, for `CURRENT_ROUTER`'s
// reason: the isomorphic `Rpc` reads these and a browser bundle must not reach what fills them.
export const RPC_SERVER: {
    request: () => Request
    raw: ((request: Request) => Promise<Response>) | null
    reached: ((rpc: object, args: unknown, value: unknown) => void) | null
} = {
    request: () => {
        throw new Error(
            'abide: a handler with middleware was called outside a request, and its rungs read the request being served. RULEBOOK 16.26.',
        )
    },
    raw: null,
    reached: null,
}
