import { GET } from 'abide/server'

/**
 * `rpc` = `memo` + transport, and this is the `memo` half spelled out: the same `MemoOptions` a local
 * keyed memo takes, on the call rather than on a cell somebody wrote beside it.
 *
 * That is what makes "three concurrent readers of one key cost ONE request" a property of the
 * declaration instead of a caching layer the caller assembles — `ttl`, `tags` and `global` mean here
 * exactly what they mean on `/docs/memo`, and the transport arranged none of it.
 *
 * `tags` in its FUNCTION form names one row rather than every row, so invalidating `user:7` reaches
 * this slot and leaves the other users alone.
 */
export const user = GET(async ({ id }: { id: number }) => ({ id, name: `user ${id}` }), {
    memo: { ttl: 30_000, tags: ({ id }) => [`user:${id}`] },
})
