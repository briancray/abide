// The ADOPTED AMBIENT shape, and the axes its three users configure differently.
//
// `route`, `identity` and `trace` each solved this separately and drifted on exactly these axes:
// whether an incoming value is validated before it is installed, whether an equal value wakes readers,
// and — once the READ LADDER moved here — what the server rung is and what "nobody has said" means.
// All four are now parameters, so the drift is a decision each ambient states rather than an accident.
// These assert the shape; the per-ambient choices are asserted through the ambients.

import { describe, expect, test } from 'bun:test'
import { watch } from '../watch.ts'
import { adoptedAmbient } from './adoptedAmbient.ts'
import { identityAmbient } from './identityAmbient.ts'
import { traceAmbient } from './traceAmbient.ts'

const isString = (value: unknown): value is string => typeof value === 'string'

async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe('the shape', () => {
    test('starts empty, adopts, and clears', () => {
        const ambient = adoptedAmbient<string>({ isValid: isString })
        expect(ambient.read()).toBeUndefined()
        ambient.adopt('a')
        expect(ambient.read()).toBe('a')
        ambient.clear()
        expect(ambient.read()).toBeUndefined()
    })

    // THE LADDER. It used to be written out in `route.ts`, `identity.ts` and `trace.ts` — three
    // spellings of "the scope's answer, then the adopted one, then the tail", with only the tail
    // legitimately differing. Nothing held the first two rungs in step.
    describe('the read ladder', () => {
        test('the scope rung wins over an adopted value', () => {
            let scoped: string | undefined = 'from-scope'
            const ambient = adoptedAmbient<string>({ isValid: isString, fromScope: () => scoped })
            ambient.adopt('adopted')
            expect(ambient.read()).toBe('from-scope')
            scoped = undefined
            expect(ambient.read()).toBe('adopted')
        })

        test('with nothing on either rung, `absent` decides', () => {
            const silent = adoptedAmbient<string>({ isValid: isString })
            expect(silent.read()).toBeUndefined()

            const loud = adoptedAmbient<string, never>({
                isValid: isString,
                absent: () => {
                    throw new Error('nobody has said')
                },
            })
            expect(() => loud.read()).toThrow('nobody has said')
            loud.adopt('a')
            expect(loud.read()).toBe('a') // ...and `absent` is not consulted once a rung answers
        })

        // `read()` consults the scope first and applies `absent` last, so it can never answer "has
        // anything been adopted" — on a server request it reports the request, and with a throwing
        // `absent` it does not return at all. `identity`'s error-message picker asks exactly that.
        test('`adopted()` reports the middle rung alone', () => {
            const ambient = adoptedAmbient<string, string>({
                isValid: isString,
                fromScope: () => 'from-scope',
                absent: () => 'floor',
            })
            expect(ambient.read()).toBe('from-scope')
            expect(ambient.adopted()).toBeUndefined()
            ambient.adopt('adopted')
            expect(ambient.read()).toBe('from-scope')
            expect(ambient.adopted()).toBe('adopted')
        })
    })

    // The rule that makes an ambient safe to feed off the wire: an invalid value is DROPPED and the
    // previous one stands, rather than the ambient becoming undefined or the garbage being installed.
    test('an invalid value is dropped and the previous one STANDS', () => {
        const ambient = adoptedAmbient<string>({ isValid: isString })
        ambient.adopt('good')
        ambient.adopt(42)
        ambient.adopt(null)
        ambient.adopt({ not: 'a string' })
        expect(ambient.read()).toBe('good')
    })

    test('the read is reactive', async () => {
        const ambient = adoptedAmbient<string>({ isValid: isString })
        let seen: string | undefined
        const stop = watch(() => {
            seen = ambient.read()
        })
        await flush()
        ambient.adopt('first')
        await flush()
        expect(seen).toBe('first')
        stop()
    })
})

describe('the `changed` axis', () => {
    test('by default an identical adopt wakes nobody', async () => {
        const ambient = adoptedAmbient<string>({ isValid: isString })
        ambient.adopt('same')
        let runs = 0
        const stop = watch(() => {
            ambient.read()
            runs++
        })
        await flush()
        const baseline = runs
        ambient.adopt('same')
        await flush()
        expect(runs).toBe(baseline)
        stop()
    })

    // With NO extra guard, the cell's own identity check decides — so a FRESH object that happens to be
    // equal still wakes. That is `route`'s case: `navigate` builds a new RouteInfo per nav, and that
    // freshness is the change signal that makes a same-route param nav republish.
    test('with no guard, a fresh-but-equal OBJECT still wakes', async () => {
        const isObject = (value: unknown): value is { a: number } =>
            typeof value === 'object' && value !== null
        const ambient = adoptedAmbient<{ a: number }>({ isValid: isObject })
        ambient.adopt({ a: 1 })
        let runs = 0
        const stop = watch(() => {
            ambient.read()
            runs++
        })
        await flush()
        const baseline = runs
        ambient.adopt({ a: 1 }) // equal by value, different object
        await flush()
        expect(runs).toBeGreaterThan(baseline)
        stop()
    })

    // The opposite choice, which is `identity`'s: an explicit VALUE comparison suppresses exactly the
    // wake the case above allows. Without it every nav would wake every reader to say nothing changed.
    test('a value guard suppresses the fresh-but-equal object', async () => {
        const isObject = (value: unknown): value is { a: number } =>
            typeof value === 'object' && value !== null
        const ambient = adoptedAmbient<{ a: number }>({
            isValid: isObject,
            changed: (current, next) => JSON.stringify(current) !== JSON.stringify(next),
        })
        ambient.adopt({ a: 1 })
        let runs = 0
        const stop = watch(() => {
            ambient.read()
            runs++
        })
        await flush()
        const baseline = runs
        ambient.adopt({ a: 1 })
        await flush()
        expect(runs).toBe(baseline)

        ambient.adopt({ a: 2 })
        await flush()
        expect(runs).toBeGreaterThan(baseline)
        stop()
    })
})

describe('identity — validates off the wire, compares by VALUE', () => {
    test('a fresh object with equal fields does NOT wake (every nav decodes a new principal)', async () => {
        identityAmbient.clear()
        identityAmbient.adopt({ id: 'u1', authenticated: true })
        let runs = 0
        const stop = watch(() => {
            identityAmbient.read()
            runs++
        })
        await flush()
        const baseline = runs
        identityAmbient.adopt({ id: 'u1', authenticated: true }) // different object, same value
        await flush()
        expect(runs).toBe(baseline)

        identityAmbient.adopt({ id: 'u2', authenticated: true })
        await flush()
        expect(runs).toBeGreaterThan(baseline)
        stop()
        identityAmbient.clear()
    })

    test('a malformed principal is dropped, leaving the previous identity standing', () => {
        identityAmbient.clear()
        identityAmbient.adopt({ id: 'real', authenticated: false })
        identityAmbient.adopt({ id: 42, authenticated: false } as never)
        identityAmbient.adopt({ authenticated: true } as never)
        expect(identityAmbient.read()?.id).toBe('real')
        identityAmbient.clear()
    })
})

describe('trace — now an adopted ambient, so it is REACTIVE', () => {
    // The behaviour this unification changed. `trace` used to be a plain field on the reactive scope,
    // so a binding reading it rendered once and then showed a stale id forever.
    test('a reader wakes when a new traceparent is adopted', async () => {
        traceAmbient.clear()
        const first = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
        const second = `00-${'c'.repeat(32)}-${'d'.repeat(16)}-01`
        traceAmbient.adopt(first)
        let seen: string | undefined
        const stop = watch(() => {
            seen = traceAmbient.read()
        })
        await flush()
        expect(seen).toBe(first)

        traceAmbient.adopt(second)
        await flush()
        expect(seen).toBe(second)
        stop()
        traceAmbient.clear()
    })

    test('a malformed traceparent is dropped — the invariant is "valid or undefined"', () => {
        traceAmbient.clear()
        const good = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
        traceAmbient.adopt(good)
        traceAmbient.adopt('not-a-traceparent')
        traceAmbient.adopt('')
        expect(traceAmbient.read()).toBe(good)
        traceAmbient.clear()
    })
})
