import { describe, expect, test } from 'bun:test'
import { streamFromIterator } from '../src/lib/server/runtime/streamFromIterator.ts'

/*
Cancelling the response stream (a client disconnect) routes into the generator's
return(), which runs its finally. If that cleanup throws, the rejection must be
swallowed — otherwise it surfaces as a process-fatal unhandled rejection on a
routine disconnect. cancel() resolving (not rejecting) is the observable proof.
*/
describe('streamFromIterator cancel does not reject on a throwing cleanup', () => {
    test('reader.cancel resolves even when the generator finally throws', async () => {
        async function* throwsOnReturn(): AsyncGenerator<number> {
            try {
                yield 1
            } finally {
                // biome-ignore lint/correctness/noUnsafeFinally: deliberately simulating a generator whose cleanup throws
                throw new Error('cleanup boom')
            }
        }
        const stream = streamFromIterator(throwsOnReturn(), {
            encodeFrame: (value) => String(value),
            encodeError: (message) => `error:${message}`,
        })
        const reader = stream.getReader()
        await expect(reader.cancel('client gone')).resolves.toBeUndefined()
    })
})
