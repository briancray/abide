import { GET, memo } from 'abide/server'
import { logStream } from '#server/logging'

// The UNIT is what the producer YIELDED. This body yields a line,
// so `tail` retains lines — a tail over a `Reactive<Line[]>` would
// retain two hundred ARRAYS instead, which is why where a tail
// over items is what you want, the item is what has to be
// produced.
const recent = memo(
    async function* ({ stream }: { stream: string }) {
        for await (const line of logStream(stream)) yield line
    },
    { tail: 200 },
)

export const logs = GET(recent)
