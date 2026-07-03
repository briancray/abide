/* The bare rpc overloads collapse `<Args, Return>` into a single `F extends RpcFn` generic:
   args come from the handler parameter, body + errors from its return. Compile-time only —
   the `_fn` bodies never run; the project typecheck is the assertion. The `@ts-expect-error`
   lines double as the `any`-degradation guard: if the body ever resolved to `any` (an
   `RpcOf` alias trap), the deliberately-wrong access below it would NOT error and TS would
   flag the directive as unused, failing the build. */
import { expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'
import { GET } from '../src/lib/server/GET.ts'
import { json } from '../src/lib/server/json.ts'

type Rates = { base: string; rate: number }

/* 1. Args from the parameter annotation; body inferred concrete from `json(value)`. */
async function _argAndBody(): Promise<void> {
    const rates = { base: 'USD', rate: 1 } as Rates
    const getRates = GET((_a: { base?: string }) => json(rates))
    const settled = await getRates({ base: 'EUR' })
    const rate: number = settled.rate // body is Rates — `.rate` is number
    void rate
    // @ts-expect-error `.base` is a string, not a number — proves body is Rates, not `any`
    const wrong: number = settled.base
    void wrong
    // @ts-expect-error the call args require `{ base?: string }`, not a number
    void getRates(123)
}

/* 2. A nullary handler → `undefined` args (the call takes none), body still inferred. */
async function _nullary(): Promise<void> {
    const ping = GET(() => json({ ok: true as const }))
    const settled = await ping()
    const ok: true = settled.ok
    void ok
}

/* 3. Body pinned explicitly via `json<T>` is honoured (not widened, not `any`). */
async function _pinnedBody(): Promise<void> {
    const rate = GET(() => json<{ rate: number }>({ rate: 1 }))
    const settled = await rate()
    const n: number = settled.rate
    void n
    // @ts-expect-error `missing` is not a key of `{ rate: number }` — proves body is concrete
    void settled.missing
}

/* 4. A stray `<Args>` type argument is a LOUD constraint error, not a silent `unknown` body. */
function _strayGenericRejected(): void {
    // @ts-expect-error `{ id: string }` does not satisfy the `RpcFn` constraint
    GET<{ id: string }>((_a) => json({ n: 1 }))
}

/* 5. Typed errors still infer through the collapsed overload. */
function _errorsInfer(caught: unknown): boolean {
    const notFound = error.typed('notFound', 404)
    const find = GET((a: { id: string }) => (a.id ? json({ n: 1 }) : notFound()))
    return find.isError(caught, 'notFound')
}

void _argAndBody
void _nullary
void _pinnedBody
void _strayGenericRejected
void _errorsInfer

test('bare rpc overload collapses to a single handler generic', () => {
    expect(typeof _argAndBody).toBe('function')
})
