/**
 * What an `Rpc` asks of the server it runs on, as slots the server fills.
 *
 * Filled by `#server/installServer.ts`, `raw` by `bootApp` and `following` by each app's followers:
 * the request a rung is handed (16.11), the app a `raw` call is answered by in process (16.42), where
 * a call reports the value it reached, so a page's render can leave it for the browser's own call
 * (41.13), and who a trigger reaches (18.3). A leaf, for
 * `CURRENT_ROUTER`'s reason: the isomorphic `Rpc` reads these and a browser bundle must not reach
 * what fills them.
 */
export const RPC_SERVER: {
    request: () => Request
    raw: ((request: Request) => Promise<Response>) | null
    reached: ((rpc: object, args: unknown, value: unknown) => void) | null
    /**
     * `ABIDE_RPC_TIMEOUT`, the `timeout` of a handler that names none.
     *
     * 16.58.
     */
    timeout: () => number | undefined
    /**
     * Every app's followers while anyone follows (`#server/Followers.ts`), which a trigger reaches.
     *
     * Empty in a browser, where a trigger is the copy's own.
     */
    following: Set<{
        /** A trigger on an `Rpc`, sent to every browser following what its pattern names. 7.10, 7.18. */
        broadcast(
            rpc: object,
            member: 'invalidate' | 'refresh',
            pattern: unknown,
        ): void
        /**
         * A free trigger, sent to every followed copy carrying one of `tags`, or to every one where
         * `tags` is `null`. 13.15.
         */
        sweep(member: 'invalidate' | 'refresh', tags: string[] | null): void
        /**
         * The `global` entry an answer came from, and the key it is filed under (`GLOBAL_GETS`).
         *
         * 18.8 — so a follower subscribed before it existed, or fed from one since evicted, is
         * fed from this one.
         */
        served(rpc: object, serving: unknown, key: string): void
    }>
    /**
     * How long a handler's own body took inside its rungs.
     *
     * 21.20 — so the answer can tell the two apart.
     */
    handled: ((rpc: object, duration: number) => void) | null
} = {
    request: () => {
        throw new Error(
            'abide: a handler with middleware was called outside a request, and its rungs read the request being served. RULEBOOK 16.25.',
        )
    },
    raw: null,
    reached: null,
    timeout: () => undefined,
    following: new Set(),
    handled: null,
}
