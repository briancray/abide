import { RedisClient } from 'bun'

import type { Store } from '#shared'
import type { Logged, LogStore } from '#shared/ledger.ts'
import { namedLogger } from '#shared/log.ts'
import type { Schema } from '#shared/Schema.ts'
import { KeptText, storeKey } from '#shared/storedValue.ts'

/** One client per URL a store names, so a `Keyed` building a store per entry opens one connection. */
const OPENED = new Map<string, RedisClient>()

/**
 * One subscriber connection per client, and the database its keyspace channels name.
 *
 * A connection that subscribes can do nothing else, so `watch` takes a duplicate — one, however
 * many values watch through the client.
 */
const SUBSCRIBERS = new WeakMap<
    RedisClient,
    Promise<{ subscriber: RedisClient; database: string }>
>()

const STORE_LOG = namedLogger('abide:reactive')

/**
 * A `Store` kept in a Redis key, from `bun`'s `RedisClient`.
 *
 * 8.32 — A FINITE `ttl` IS ALSO REDIS'S OWN EXPIRY, so an entry nothing reads again is evicted by
 * the server rather than held until the next `get`. 8.33 — `watch` follows the key's keyspace
 * channel, which carries news only where the server's `notify-keyspace-events` enables it.
 *
 * 58.9 — AND AN APPEND FACE, for a `ledger`: a Stream at `<key>:log` whose IDs are the entries'
 * numbers (`0-<seq>`), the last number at `<key>:seq`, the keys appended under at `<key>:keys`
 * and the cursors at `<key>:cursors`. AN APPEND IS ONE SCRIPT (`APPEND`): the key's lookup, the
 * number and the write run as one step on the server, so two processes appending at once never
 * take one number, leave one out, or keep one key twice.
 */
export function redis<Stored>(
    client: RedisClient | string,
    key: string,
    options?: { schema?: Schema<Stored> | undefined },
): Store<Stored> & LogStore {
    const redis = typeof client === 'string' ? opened(client) : client
    const schema = options?.schema as Schema<unknown> | undefined
    const kept = new KeptText()
    return {
        get: async () => {
            const stored = storeKey(key)
            const text = await redis.get(stored)
            const where = `redis[${JSON.stringify(stored)}]`
            return kept.read(text, schema, where) as Stored | undefined
        },
        set: async (value, retention) => {
            const text = kept.write(value, retention.ttl)
            if (Number.isFinite(retention.ttl))
                await redis.set(
                    storeKey(key),
                    text,
                    'PX',
                    Math.max(1, Math.ceil(retention.ttl)),
                )
            else await redis.set(storeKey(key), text)
        },
        watch: (changed) => {
            const listener = (): void => changed()
            let channels: string[] = []
            let stopped = false
            const subscribed = subscriberOf(redis).then(
                async ({ subscriber, database }) => {
                    if (stopped) return
                    // 58.12 — one watch for the key: its value written, or its log appended to.
                    channels = [
                        `__keyspace@${database}__:${storeKey(key)}`,
                        `__keyspace@${database}__:${storeKey(key)}:log`,
                    ]
                    for (const channel of channels)
                        await subscriber.subscribe(channel, listener)
                    return subscriber
                },
            )
            subscribed.catch((failed: unknown) => {
                STORE_LOG.warning(
                    `store.redis(${JSON.stringify(key)}) could not subscribe to its keyspace channel.`,
                    failed,
                )
            })
            return () => {
                stopped = true
                void subscribed.then(
                    (subscriber) => {
                        if (subscriber !== undefined)
                            for (const channel of channels)
                                void subscriber.unsubscribe(channel, listener)
                    },
                    () => {},
                )
            }
        },
        ...logFace(redis, () => storeKey(key)),
    }
}

/**
 * 58.2, 58.4 — one append, run on the server as one step: the key's entry where it was kept, else
 * the next number, the entry written under it, and the key filed against it.
 * KEYS: the last number, the log, the keys. ARGV: the key ('' for none), when, the entry as JSON.
 */
const APPEND = `
if ARGV[1] ~= '' then
  local seen = redis.call('HGET', KEYS[3], ARGV[1])
  if seen then return tonumber(seen) end
end
local seq = redis.call('INCR', KEYS[1])
redis.call('XADD', KEYS[2], '0-' .. seq, 'at', ARGV[2], 'key', ARGV[1], 'entry', ARGV[3])
if ARGV[1] ~= '' then redis.call('HSET', KEYS[3], ARGV[1], seq) end
return seq
`

/** 58.9 — the append face over the Stream at `<log()>:log` and its three keys beside it. */
/**
 * 58.4, 58.10 — a trim on the server as one step: the keys of every entry through `ARGV[1]` let go
 * with their entries, so a key outlives no entry. KEYS: the log, the keys.
 */
const TRIM = `
local going = redis.call('XRANGE', KEYS[1], '-', '0-' .. ARGV[1])
for _, item in ipairs(going) do
  local fields = item[2]
  for index = 1, #fields, 2 do
    if fields[index] == 'key' and fields[index + 1] ~= '' then
      redis.call('HDEL', KEYS[2], fields[index + 1])
    end
  end
end
redis.call('XTRIM', KEYS[1], 'MINID', '0-' .. (tonumber(ARGV[1]) + 1))
return #going
`

function logFace(redis: RedisClient, log: () => string): LogStore {
    return {
        append: async (entry, key, at) => {
            const base = log()
            const seq = await redis.send('EVAL', [
                APPEND,
                '3',
                `${base}:seq`,
                `${base}:log`,
                `${base}:keys`,
                key ?? '',
                String(at),
                JSON.stringify(entry),
            ])
            return Number(seq)
        },
        since: async (seq) => {
            const reply = (await redis.send('XRANGE', [
                `${log()}:log`,
                `(0-${seq}`,
                '+',
                'COUNT',
                '256',
            ])) as [string, string[]][] | null
            const entries: Logged<unknown>[] = []
            for (const [id, fields] of reply ?? []) {
                let at = 0
                let text = 'null'
                for (let index = 0; index < fields.length; index += 2) {
                    if (fields[index] === 'at') at = Number(fields[index + 1])
                    else if (fields[index] === 'entry')
                        text = fields[index + 1] as string
                }
                entries.push({
                    seq: Number(id.slice(id.indexOf('-') + 1)),
                    at,
                    entry: JSON.parse(text),
                })
            }
            return entries
        },
        last: async () => Number((await redis.get(`${log()}:seq`)) ?? 0),
        position: async (cursor, seq) => {
            const cursors = `${log()}:cursors`
            if (seq !== undefined) {
                await redis.send('HSET', [cursors, cursor, String(seq)])
                return seq
            }
            return Number((await redis.send('HGET', [cursors, cursor])) ?? 0)
        },
        trim: async (through) => {
            const base = log()
            await redis.send('EVAL', [
                TRIM,
                '2',
                `${base}:log`,
                `${base}:keys`,
                String(through),
            ])
        },
    }
}

function opened(url: string): RedisClient {
    let client = OPENED.get(url)
    if (client === undefined) {
        client = new RedisClient(url)
        OPENED.set(url, client)
    }
    return client
}

function subscriberOf(
    redis: RedisClient,
): Promise<{ subscriber: RedisClient; database: string }> {
    let pending = SUBSCRIBERS.get(redis)
    if (pending === undefined) {
        pending = (async () => {
            // `CLIENT INFO` names the database this connection selected, which the channel carries.
            const info = String(await redis.send('CLIENT', ['INFO']))
            const database = /\bdb=(\d+)/.exec(info)?.[1] ?? '0'
            return { subscriber: await redis.duplicate(), database }
        })()
        SUBSCRIBERS.set(redis, pending)
        // A failed connection is not kept, so the next `watch` tries again.
        pending.catch(() => SUBSCRIBERS.delete(redis))
    }
    return pending
}
