/*
The subset of the `__SSR__` payload the client seeds into ambient slots at boot: the
mount base, the default log channel (app name), the warm health payload, and the
env-configured RPC client timeout. Every field here is stamped by the server's SSR
state tag and MUST be seeded client-side by `seedBootState`, whose seed map is keyed
EXHAUSTIVELY off this type — so a field added here fails to compile until both sides
wire it. That compile error is the guard closing the silent stamped-but-unseeded gap
(the bug that left `ABIDE_CLIENT_TIMEOUT` inoperative in the browser while every test
still passed).
*/
export type SsrBootState = {
    /* The mount base (`base || undefined`); seeds the base resolver so call keys and
       navigation resolve rooted paths. Seeded first — the cache seed that follows keys
       through it. */
    base?: string
    /* The app name — the default log channel; falls back to `'app'` when absent. */
    app?: string
    /* The health payload, so `health()`'s first client probe is warm rather than cold. */
    health?: Record<string, unknown>
    /* The env-configured RPC client timeout (`ABIDE_CLIENT_TIMEOUT`), shipped per request;
       absent → unbounded client fetches. */
    clientTimeout?: number
}
