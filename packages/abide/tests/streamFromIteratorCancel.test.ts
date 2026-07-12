import { describe, expect, spyOn, test } from 'bun:test'
import { streamFromIterator } from '../src/lib/server/runtime/streamFromIterator.ts'
import { abideLog } from '../src/lib/shared/abideLog.ts'

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

    /*
    The common disconnect shape: a `pull` is parked on `iterator.next()` in the idle
    gap between frames when the client drops. cancel() closes the controller, then the
    parked next() resolves — the resumed pull must NOT touch the now-closed controller,
    or close() throws "Controller is already closed", which the catch logs as a stray
    framework error on every mid-frame disconnect. abideLog.error staying untouched is
    the observable proof the guard short-circuited.
    */
    test('a pull resolving after cancel does not error on the closed controller', async () => {
        // A tick feed with an idle gap between frames — the SSE shape exactly.
        async function* ticker(): AsyncGenerator<number> {
            for (let tick = 1; ; tick += 1) {
                yield tick
                await Bun.sleep(50)
            }
        }
        const stream = streamFromIterator(ticker(), {
            encodeFrame: (value) => String(value),
            encodeError: (message) => `error:${message}`,
        })
        const reader = stream.getReader()
        const errorSpy = spyOn(abideLog, 'error').mockImplementation(() => {})
        try {
            await reader.read()
            await reader.read()
            // Cancel partway into the between-frame sleep, so the follow-up pull is parked
            // inside iterator.next() when the controller closes.
            await Bun.sleep(20)
            await reader.cancel('client gone')
            // Let the parked sleep settle so the post-cancel pull resumes and runs its path.
            await Bun.sleep(80)
            expect(errorSpy).not.toHaveBeenCalled()
        } finally {
            errorSpy.mockRestore()
        }
    })
})
