import { error, GET } from 'abide/server'

/**
 * A chain over ONE endpoint, and the word "every" is the whole claim: it runs for a fetch, for a
 * websocket frame, and for an in-process call from the server's own render.
 *
 * That last one is what makes this the right place for authorization. The app's `middleware` sees
 * REQUESTS, and a page that renders this rpc server-side never makes one — so a check written there
 * is a check the SSR path walks straight past, and the endpoint is open to exactly the caller who
 * arrived through the front door.
 *
 * `next()` takes NO arguments, like every other onion in abide, and the args are the second parameter
 * — because an authorization that cannot see what was asked for can only ever be per-endpoint. The
 * refusal is a plain `error()`, which throws, so nothing below it needs a branch.
 *
 * A RUNG IS SYNCHRONOUS TODAY, and that is a limit rather than a style: `next()` hands back
 * `T | Promise<T> | AsyncIterable<T>`, so an `async` rung is a promise of that union and does not
 * typecheck against what a rung may return. An authorization that has to await — `identity()` is a
 * promise on the server — resolves it outside the chain for now. See `RpcMiddleware` in
 * `$server/rpc.ts`, which carries the same note beside what would have to widen.
 */
export const secrets = GET(({ id }: { id: number }) => ({ id, secret: 'kept' }), {
    middleware: [
        (next, args) => {
            if (args.id <= 0) error(400, 'no such id')
            return next()
        },
    ],
})
