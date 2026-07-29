// The hook the generated companion derives `health()`'s app fields from.
export function onHealth(): { db: string; queueDepth: number } {
    return { db: 'ok', queueDepth: 0 }
}
