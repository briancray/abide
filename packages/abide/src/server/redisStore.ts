import { RedisClient } from 'bun'

import type { Store } from '#shared'
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
 */
export function redisStore<Stored>(
    client: RedisClient | string,
    key: string,
    options?: { schema?: Schema<Stored> },
): Store<Stored> {
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
            let channel: string | undefined
            let stopped = false
            const subscribed = subscriberOf(redis).then(
                async ({ subscriber, database }) => {
                    if (stopped) return
                    channel = `__keyspace@${database}__:${storeKey(key)}`
                    await subscriber.subscribe(channel, listener)
                    return subscriber
                },
            )
            subscribed.catch((failed: unknown) => {
                STORE_LOG.warning(
                    `redisStore(${JSON.stringify(key)}) could not subscribe to its keyspace channel.`,
                    failed,
                )
            })
            return () => {
                stopped = true
                void subscribed.then(
                    (subscriber) => {
                        if (subscriber !== undefined && channel !== undefined)
                            void subscriber.unsubscribe(channel, listener)
                    },
                    () => {},
                )
            }
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
