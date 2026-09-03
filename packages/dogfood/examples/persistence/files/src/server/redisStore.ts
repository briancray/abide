import type { Store } from 'abide'
import { redis } from '#server/redis'

export function redisStore<T>(key: string): Store<T | undefined> {
    return {
        get: async () => {
            const text = await redis.get(key)
            return text === null ? undefined : (JSON.parse(text) as T)
        },
        // `set` is handed the `Reactive`'s own `ttl`, in ms, so the
        // number lives once on the value and the store converts it.
        set: (value, { ttl }) => {
            const text = JSON.stringify(value)
            return ttl === Infinity
                ? redis.set(key, text)
                : redis.set(key, text, 'EX', Math.ceil(ttl / 1000))
        },
    }
}
