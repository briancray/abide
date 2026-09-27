// WHAT AN `Rpc` ASKS OF THE SERVER IT RUNS ON, as slots the server fills (`#server/requestScope.ts`,
// `#server/createApp.ts`, `#server/answerRequest.ts`): the request a rung is handed (16.12), the app
// a `raw` call is answered by in process (16.44), and where a call reports the value it reached, so
// a page's render can leave it for the browser's own call (41.13). A leaf, for `CURRENT_ROUTER`'s
// reason: the isomorphic `Rpc` reads these and a browser bundle must not reach what fills them.
export const RPC_SERVER: {
    request: () => Request
    raw: ((request: Request) => Promise<Response>) | null
    reached: ((rpc: object, args: unknown, value: unknown) => void) | null
    // 16.63 — `ABIDE_RPC_TIMEOUT`, the `timeout` of a handler that names none.
    timeout: () => number | undefined
    // 7.10, 7.18 — a trigger on an `Rpc`, sent to every browser following what its pattern names.
    broadcast:
        | ((
              rpc: object,
              member: 'invalidate' | 'refresh',
              pattern: unknown,
          ) => void)
        | null
    // 18.23 — the `global` entry an answer came from, so a follower subscribed before it existed, or
    // fed from one since evicted, is fed from this one.
    served: ((rpc: object, serving: unknown) => void) | null
} = {
    request: () => {
        throw new Error(
            'abide: a handler with middleware was called outside a request, and its rungs read the request being served. RULEBOOK 16.26.',
        )
    },
    raw: null,
    reached: null,
    timeout: () => undefined,
    broadcast: null,
    served: null,
}
