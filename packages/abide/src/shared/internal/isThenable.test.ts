// `isThenable` GUARDS an `await`, so the only correct contract is "answers what `await` would do".
//
// This is not an abstract property. `emitServer` writes `$rt.isThenable($v) ? await $v : $v` at every
// expression slot, and the client runtime branches on the same predicate — so any value where the two
// disagree renders its own source text instead of its resolved value, silently, on BOTH sides (no
// hydration mismatch to notice, just the wrong answer). The case that used to diverge is a CALLABLE
// thenable: the shared predicate required `typeof === 'object'` while `memo` carried a second copy that
// also accepted `'function'`, which is what `await` does.
//
// The end-to-end assertion is the load-bearing one — a unit test over the predicate alone would have
// passed just as happily with the emit path reading a different copy.

import { expect, test } from 'bun:test'
import { loadEmitted } from '../../ui/internal/emit.ts'
import { isThenable } from './isThenable.ts'

// A function that is also a thenable. `await` follows `.then` here exactly as on a plain object.
function callableThenable<T>(value: T): () => void {
    const fn = (() => {}) as (() => void) & { then: (resolve: (v: T) => void) => void }
    // biome-ignore lint/suspicious/noThenProperty: a thenable that is ALSO callable is the subject under test — the shape the predicate used to miss
    fn.then = (resolve) => resolve(value)
    return fn
}

test('isThenable agrees with `await` across every shape `await` treats as awaitable', async () => {
    const cases: unknown[] = [
        Promise.resolve(1),
        // biome-ignore lint/suspicious/noThenProperty: a hand-rolled thenable is exactly what this asserts the predicate follows
        { then: (resolve: (v: number) => void) => resolve(1) },
        callableThenable(1),
        // …and everything `await` passes straight through.
        1,
        'x',
        null,
        undefined,
        {},
        () => {},
        [],
    ]
    for (const value of cases) {
        // `await` on a non-thenable yields the value itself; on a thenable it yields what `.then` resolves.
        const awaited = await (value as Promise<unknown>)
        const followedThen = awaited !== value
        expect(isThenable(value)).toBe(followedThen)
    }
})

test('a callable thenable in an interpolation renders its RESOLVED value, not its source text', async () => {
    const mod = await loadEmitted('<p>{v}</p>')
    const html = await mod.render({ v: callableThenable('RESOLVED') })
    expect(html).toContain('RESOLVED')
    expect(html).not.toContain('function')
})
