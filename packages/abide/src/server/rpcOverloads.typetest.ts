// Type-level verification of the verb overloads (input-schema-first inference, option-5 default
// inference, output conformance). Not a runtime test — its value is whether `tsc --noEmit` accepts the
// success cases and flags every `@ts-expect-error`. Kept out of the bundle (never imported).

import { GET } from 'abide/server/GET'
import { POST } from 'abide/server/POST'
import type { StandardSchemaV1 } from 'abide/shared/StandardSchema'

// A fake Standard Schema whose parsed OUTPUT type is `O` (what the handler receives after validation).
function schema<I, O>(): StandardSchemaV1<I, O> {
    return {
        '~standard': {
            version: 1,
            vendor: 'typetest',
            validate: (value: unknown) => ({ value: value as O }),
        },
    }
}

// A type-only equality assertion — `AssertTrue<Expect<A, B>>` is a compile error unless A and B are
// mutually assignable, so each `type _N = ...` below pins the inferred `Args`, not just "it compiled".
type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertTrue<T extends true> = T

// 1. INPUT schema drives the handler arg — no annotation; `message` is the PARSED `string`.
const withInput = GET(({ message }) => ({ echoed: message, length: message.length }), {
    schemas: { input: schema<{ message?: string }, { message: string }>() },
})
type _1 = AssertTrue<Expect<Parameters<typeof withInput>[0], { message: string }>>

// 2. Option 5 — unannotated destructuring default, NO schema: arg typed from the default, no error.
const defaulted = GET(({ message = 'hello' }) => ({ echoed: message, length: message.length }))
type _2 = AssertTrue<Expect<Parameters<typeof defaulted>[0]['message'], string | undefined>>

// 3. Zero-arg read still works (arg optional).
const zero = GET(() => ({ ok: true }))
zero.live()

// 4. Explicit annotation still works.
const annotated = GET((args: { id: string }) => ({ id: args.id }))
type _4 = AssertTrue<Expect<Parameters<typeof annotated>[0], { id: string }>>

// 5. Explicit generic still works — the caller's `T` flows through as `Args`.
function makeById<T extends { id: string }>() {
    return GET((args: T) => ({ id: args.id }))
}
const byId = makeById<{ id: string; extra: number }>()
type _5 = AssertTrue<Expect<Parameters<typeof byId>[0], { id: string; extra: number }>>

// 6. OUTPUT schema is checked against the return — a matching schema is accepted.
POST(({ message }) => ({ echoed: message }), {
    schemas: {
        input: schema<{ message?: string }, { message: string }>(),
        output: schema<{ echoed: string }, { echoed: string }>(),
    },
})

// 7. OUTPUT schema MISMATCH — the handler returns a shape the output schema can't accept. The error
// surfaces at the call (overload fallthrough), not the `output:` property — cosmetic, but it DOES fire.
// @ts-expect-error handler returns `{ WRONG }`, output schema expects `{ echoed }`
POST(({ message }) => ({ WRONG: message }), {
    schemas: {
        input: schema<{ message?: string }, { message: string }>(),
        output: schema<{ echoed: string }, { echoed: string }>(),
    },
})
