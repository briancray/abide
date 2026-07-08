/* Body-inferred typed errors: a handler that RETURNS an `error.typed(...)` constructor
   exposes that error's kind + typed data on the rpc's `isError` — no `errors:` option, no
   set. The surface is inferred from the handler's return type. Compile-time: the `_fn`
   bodies never run; the project typecheck is the assertion (mirrors rpcTypedErrors.test.ts). */
import { expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'
import { json } from '../src/lib/server/json.ts'
import { POST } from '../src/lib/server/POST.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

/* Real `~standard`-typed schemas so InferInput is concrete (a validate-only literal would
   collapse `.data` to unknown — see rpcTypedErrors.test.ts). */
const stockSchema = undefined as unknown as StandardSchemaV1<{ available: number }>
const couponSchema = undefined as unknown as StandardSchemaV1<{ code: string }>

/* 1. Single inferred error: kind + typed `.data`, no `errors:` option in sight. */
function _inferSingle(caught: unknown): number | undefined {
    const outOfStock = error.typed('outOfStock', 409, stockSchema)
    const sell = POST(
        ({ available }: { available: number }) =>
            available > 0 ? json({ ok: true as const }) : outOfStock({ available: 0 }),
        { schemas: { input: stockSchema } },
    )
    if (sell.isError(caught, 'outOfStock')) {
        return caught.data.available // typed number — inferred from the returned constructor
    }
    return undefined
}

/* 2. Union inferred from two distinct constructors returned in the same body. */
function _inferUnion(caught: unknown): string | number | undefined {
    const outOfStock = error.typed('outOfStock', 409, stockSchema)
    const badCoupon = error.typed('badCoupon', 400, couponSchema)
    const checkout = POST(
        (args: { available: number }) => {
            if (args.available < 0) return outOfStock({ available: 0 })
            if (args.available === 0) return badCoupon({ code: 'X' })
            return json({ ok: true as const })
        },
        { schemas: { input: stockSchema } },
    )
    if (checkout.isError(caught, 'outOfStock')) return caught.data.available
    if (checkout.isError(caught, 'badCoupon')) return caught.data.code
    return undefined
}

/* 3. A nullary typed error narrows its kind (no data schema → `.data` stays unknown). */
function _inferNullary(caught: unknown): boolean {
    const rateLimited = error.typed('rateLimited', 429)
    const ping = POST(
        ({ available }: { available: number }) =>
            available > 0 ? json({ ok: true }) : rateLimited(),
        { schemas: { input: stockSchema } },
    )
    return ping.isError(caught, 'rateLimited')
}

/* 4. Return stays the success body — error branches don't pollute the resolved value. */
async function _returnUnpolluted(): Promise<boolean> {
    const outOfStock = error.typed('outOfStock', 409, stockSchema)
    const sell = POST(
        ({ available }: { available: number }) =>
            available > 0 ? json({ ok: true as const }) : outOfStock({ available: 0 }),
        { schemas: { input: stockSchema } },
    )
    const result = await sell({ available: 1 })
    return result.ok // result is { ok: true }, not widened by the error branch
}

/* 5. Negative: the inferred `.data` is concretely typed (number), not `any`/`unknown` — a
   wrong-type assignment must error, so this @ts-expect-error stays "used". */
function _dataIsConcrete(caught: unknown): void {
    const outOfStock = error.typed('outOfStock', 409, stockSchema)
    const sell = POST((_a: { available: number }) => outOfStock({ available: 0 }), {
        schemas: { input: stockSchema },
    })
    if (sell.isError(caught, 'outOfStock')) {
        // @ts-expect-error `.data.available` is number, not string
        const s: string = caught.data.available
        void s
    }
}

void _inferSingle
void _inferUnion
void _inferNullary
void _returnUnpolluted
void _dataIsConcrete

test('body-inferred typed errors compile', () => {
    expect(typeof _inferSingle).toBe('function')
})
