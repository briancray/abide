import { config } from 'abide/server'

/**
 * Three knobs, declared in the environment because they are the operator's:
 *
 *   `ABIDE_MAX_GLOBAL_CACHE_SIZE`  — a `{ global }` cache's size, evicted least-recently-USED, where
 *                                    recency comes off the select every access already goes through.
 *   `ABIDE_MAX_STREAM_BUFFER_SIZE` — charged bytes a stream's transcript may retain. A cap on what is
 *                                    remembered must not become a cost per write, so the buffer is
 *                                    appended to and the snapshot is taken on the read.
 *   `ABIDE_SSR_STREAM_BUDGET`      — milliseconds a render may wait on suspended regions before it
 *                                    sends what it has.
 */
export function declared(): { cache: number; buffer: number; budget: number } {
    const settings = config()
    return {
        cache: settings.ABIDE_MAX_GLOBAL_CACHE_SIZE,
        buffer: settings.ABIDE_MAX_STREAM_BUFFER_SIZE,
        budget: settings.ABIDE_SSR_STREAM_BUDGET,
    }
}
