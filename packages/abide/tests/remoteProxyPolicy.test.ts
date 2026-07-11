import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { validationError } from '../src/lib/server/rpc/validationError.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import { httpErrorFor } from '../src/lib/shared/httpErrorFor.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { importedNameSchema } from './support/importedNameSchema.ts'
import { settle } from './support/settle.ts'

/* ADR-0020 client gap: the endpoint's cache/stream policy ships to the client on the
   RemoteFunction, so a client-side smart read honours the declared ttl (staleness/SWR) and the
   refetch clock (throttle/debounce) — not just the server-side read. These run under a defined
   `window` (the smart read's retain branch is client-only) with a stubbed fetch. */

const realFetch = globalThis.fetch

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

describe('remoteProxy endpoint policy — client-side (ADR-0020)', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('the proxy exposes the endpoint cache/stream policy on both variants', () => {
        const getRates = remoteProxy<{ base: string }, { rate: number }>('GET', '/rpc/rates', {
            cache: { ttl: 20, tags: (args) => [`rates:${args.base}`] },
            stream: { n: 5 },
        })
        expect(getRates.cache?.ttl).toBe(20)
        expect(typeof getRates.cache?.tags).toBe('function')
        expect(getRates.stream?.n).toBe(5)
        /* readThrough may read policy off `fn` or `fn.raw` — both must carry it. */
        expect(getRates.raw.cache?.ttl).toBe(20)
    })

    test('an IMPORTED policy value is honored — ADR-0022: opts is a live expression, not a lifted literal', () => {
        /* Stands in for `import { RATE_TTL, ratePolicy } from '$shared/ratePolicy'` — the D2 client
           transform forwards the live opts object, so a policy composed from imported values reaches
           the client proxy exactly as a literal would. The old text-splice could only carry inline
           literals; this is the constraint the ADR deletes. */
        const RATE_TTL = 60_000
        const ratePolicy = {
            ttl: RATE_TTL,
            debounce: 300,
            tags: (args: { base?: string }) => [`rates:${args.base ?? 'USD'}`],
        }
        const getRates = remoteProxy<{ base?: string }, { rate: number }>(
            'GET',
            '/rpc/importedRates',
            {
                cache: ratePolicy,
            },
        )
        expect(getRates.cache?.ttl).toBe(RATE_TTL)
        expect(getRates.cache?.debounce).toBe(300)
        expect(
            (getRates.cache!.tags as (a: { base?: string }) => string[])({ base: 'EUR' }),
        ).toEqual(['rates:EUR'])
        expect(getRates.raw.cache?.ttl).toBe(RATE_TTL)
    })

    test('no policy → cache/stream undefined (unchanged default)', () => {
        const plain = remoteProxy<undefined, { ok: boolean }>('GET', '/rpc/plain')
        expect(plain.cache).toBeUndefined()
        expect(plain.stream).toBeUndefined()
    })

    test('a read past the endpoint ttl revalidates in place, keeping the stale value visible', async () => {
        let n = 0
        let releaseSecond: () => void = () => {}
        const secondReady = new Promise<void>((resolve) => {
            releaseSecond = resolve
        })
        globalThis.fetch = (async () => {
            n += 1
            /* The revalidation fetch parks so refreshing() is observable mid-flight. */
            if (n === 2) {
                await secondReady
            }
            return jsonResponse({ n })
        }) as unknown as typeof fetch
        const getN = remoteProxy<undefined, { n: number }>('GET', '/rpc/policyN', {
            cache: { ttl: 20 },
        })
        expect(await getN(undefined)).toEqual({ n: 1 })
        /* Let the staleness deadline pass; revalidation is access-triggered, so waiting fires
           nothing on its own. */
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(refreshing(getN)).toBe(false)
        /* The next read is past the deadline: serves the stale value now and kicks a background
           revalidation (n === 2, parked) — proving the endpoint ttl reached the client. */
        expect(await getN(undefined)).toEqual({ n: 1 })
        expect(refreshing(getN)).toBe(true)
        releaseSecond()
        await settle()
        expect(refreshing(getN)).toBe(false)
        expect(await getN(undefined)).toEqual({ n: 2 })
    })

    test('the endpoint refetch clock (debounce) governs client invalidation — a burst collapses to one refetch', async () => {
        let fetches = 0
        globalThis.fetch = (async () => {
            fetches += 1
            return jsonResponse({ n: fetches })
        }) as unknown as typeof fetch
        const getThing = remoteProxy<undefined, { n: number }>('GET', '/rpc/policyDebounce', {
            cache: { debounce: 30 },
        })
        expect(await getThing(undefined)).toEqual({ n: 1 })
        expect(fetches).toBe(1)
        /* Three invalidations inside the debounce window — the endpoint's clock, not a call
           option — collapse to a single trailing refetch. */
        cache.invalidate(getThing)
        cache.invalidate(getThing)
        cache.invalidate(getThing)
        /* Still serving the stale value while the window is open. */
        expect(await getThing(undefined)).toEqual({ n: 1 })
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(await getThing(undefined)).toEqual({ n: 2 })
        expect(fetches).toBe(2)
    })
})

/* ADR-0026: client-side pre-flight input validation — always on. Whenever an endpoint carries
   `schemas.input`, remoteProxy validates the TYPED args against it before the fetch and, on a
   returned failure, throws an HttpError shaped identically to the server's 422 — saving the
   round-trip. A validator that THROWS (can't run client-side) falls through to the server rather
   than failing the call. Server validation stays authoritative regardless; this is UX only. */

/* A rejecting Standard Schema: requires a non-empty string `name`, else one issue at ['name'].
   `async: true` returns the result as a Promise to exercise the awaited-validate path (D3). */
function nameSchema(async = false): StandardSchemaV1<{ name: string }, { name: string }> {
    return {
        '~standard': {
            version: 1,
            vendor: 'abide-test',
            validate(value: unknown) {
                const name = (value as { name?: unknown } | undefined)?.name
                const result: StandardSchemaV1.Result<{ name: string }> =
                    typeof name === 'string' && name.length > 0
                        ? { value: { name } }
                        : { issues: [{ message: 'Required', path: ['name'] }] }
                return async ? Promise.resolve(result) : result
            },
        },
    }
}

/* The issues the schema yields for a given (invalid) input — used to build the SERVER's 422 for
   the identical-shape assertion. */
function issuesFor(input: unknown): readonly StandardSchemaV1.Issue[] {
    const result = nameSchema()['~standard'].validate(input) as StandardSchemaV1.FailureResult
    return result.issues
}

/* A Standard Schema whose validator THROWS (cannot complete in this environment) rather than
   returning issues — models a non-portable / async-resource refinement. The client pre-flight must
   fall through to the server on this, never hard-fail the call. */
function throwingSchema(): StandardSchemaV1<{ name: string }, { name: string }> {
    return {
        '~standard': {
            version: 1,
            vendor: 'abide-test',
            validate() {
                throw new Error('validator cannot run in this environment')
            },
        },
    }
}

describe('remoteProxy client-side pre-flight validation (ADR-0026)', () => {
    let fetchCalls = 0
    beforeEach(() => {
        fetchCalls = 0
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
        globalThis.fetch = (async () => {
            fetchCalls += 1
            return jsonResponse({ ok: true })
        }) as unknown as typeof fetch
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('invalid args → throws the SERVER-identical 422 before any fetch', async () => {
        const signup = remoteProxy<{ name: string }, { ok: boolean }>('POST', '/rpc/signup', {
            schemas: { input: nameSchema() },
        })
        let thrown: unknown
        try {
            await signup({ name: '' })
        } catch (error) {
            thrown = error
        }
        /* No round-trip: the pre-flight rejected before dispatch. */
        expect(fetchCalls).toBe(0)
        expect(thrown).toBeInstanceOf(HttpError)
        const clientError = thrown as HttpError
        /* The exact HttpError a caller gets when the SERVER rejects the same schema + input. */
        const serverError = await httpErrorFor(validationError(issuesFor({ name: '' })))
        expect(clientError.status).toBe(422)
        expect(clientError.status).toBe(serverError.status)
        expect(clientError.statusText).toBe(serverError.statusText)
        expect(clientError.kind).toBe('validation')
        expect(clientError.kind).toBe(serverError.kind)
        expect(clientError.message).toBe(serverError.message)
        expect(clientError.data).toEqual(serverError.data)
        /* The form-friendly field map is the shape a caller's 422 handler reads. */
        expect((clientError.data as { fields: Record<string, string> }).fields).toEqual({
            name: 'Required',
        })
    })

    test('valid args → validates, then fetches normally', async () => {
        const signup = remoteProxy<{ name: string }, { ok: boolean }>('POST', '/rpc/signupOk', {
            schemas: { input: nameSchema() },
        })
        expect(await signup({ name: 'ada' })).toEqual({ ok: true })
        expect(fetchCalls).toBe(1)
    })

    test('no input schema → sends without validating', async () => {
        const signup = remoteProxy<{ name: string }, { ok: boolean }>(
            'POST',
            '/rpc/signupNoSchema',
            {},
        )
        expect(await signup({ name: '' })).toEqual({ ok: true })
        expect(fetchCalls).toBe(1)
    })

    test('a validator that THROWS falls through to the server (never hard-fails the call)', async () => {
        const signup = remoteProxy<{ name: string }, { ok: boolean }>('POST', '/rpc/signupThrows', {
            schemas: { input: throwingSchema() },
        })
        /* The validator cannot run here — the client must NOT reject; it fetches and lets the
           authoritative server validate. */
        expect(await signup({ name: '' })).toEqual({ ok: true })
        expect(fetchCalls).toBe(1)
    })

    test('async schema (validate returns a Promise) is awaited before the fetch decision', async () => {
        const signup = remoteProxy<{ name: string }, { ok: boolean }>('POST', '/rpc/signupAsync', {
            schemas: { input: nameSchema(true) },
        })
        await expect(signup({ name: '' })).rejects.toBeInstanceOf(HttpError)
        expect(fetchCalls).toBe(0)
        expect(await signup({ name: 'grace' })).toEqual({ ok: true })
        expect(fetchCalls).toBe(1)
    })

    test('an IMPORTED schema validates client-side (ADR-0022 D2 live-opts reach)', async () => {
        const signup = remoteProxy<{ name: string }, { ok: boolean }>(
            'POST',
            '/rpc/signupImported',
            {
                schemas: { input: importedNameSchema },
            },
        )
        await expect(signup({ name: '' })).rejects.toBeInstanceOf(HttpError)
        expect(fetchCalls).toBe(0)
        expect(await signup({ name: 'linus' })).toEqual({ ok: true })
        expect(fetchCalls).toBe(1)
    })
})
