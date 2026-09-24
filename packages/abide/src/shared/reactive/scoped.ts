// 11.32, 11.38 AND 11.68 — A VALUE BUILT OUTSIDE EVERY SCOPE, ON A SERVER. A module's `reactive` is built
// once, when the module is first imported, and every request after that reaches the same object —
// so the value it hands back is a FORWARDER: outside a request it is the value built at import
// (the HOME), and inside one it is an instance of its own, built the first time that request
// reaches it and dropped with the request.
//
// A FORWARDER RATHER THAN A SCOPE LOOKUP IN THE CORE. A read captures its cell and nothing else,
// and it is the hottest path in the design; a browser never builds a forwarder, so what the read
// costs there is exactly what it cost before, and the lookup is paid on a server alone.
//
// THE INSTANCE IS A WHOLE VALUE, not a cell under the forwarder. A value moves between prototypes
// while it adopts (`ADOPTING_PROTOTYPE`), and one callable shared by every request would be moved
// for all of them by the first.

import { CELL } from './CELL.ts'
import { ARGS_GATE } from './ARGS_GATE.ts'
import type { Gated } from './Keyed.ts'
import { KEYED_BRAND } from './KEYED_BRAND.ts'
import { brandedPrototype, MEMBER_KEYS } from './Reactive.ts'
import { SELECTION_MEMBERS } from './SELECTION_MEMBERS.ts'
import { currentScope, SCOPING } from './scoping.ts'

// What a forwarder resolves through: the home, and how to build the same value again in a scope.
class Filed {
    home: unknown
    make: () => unknown

    constructor(make: () => unknown) {
        this.make = make
        this.home = make()
    }
}

const FILED: unique symbol = Symbol('abide.filed')

type Forwarder = { [FILED]: Filed }

// The instance for the scope that is current, built there the first time it is reached. Built
// INSIDE the scope, so every cell it makes records that scope as its own (`Cell.scope`).
function instanceOf(filed: Filed): Record<PropertyKey, unknown> {
    const scope = currentScope()
    if (scope === undefined) return filed.home as Record<PropertyKey, unknown>
    let instance = scope.instances.get(filed)
    if (instance === undefined) {
        instance = filed.make()
        scope.instances.set(filed, instance)
    }
    return instance as Record<PropertyKey, unknown>
}

// EVERY MEMBER, FORWARDED — and the cell too, as a getter, because the core reaches a value's
// record through `[CELL]` wherever one value is handed to another (an adoption, a `set` of a
// `Reactive`, a `watch` over named sources). Under `Function.prototype` for `MEMBER_PROTOTYPE`'s
// reason: the forwarder is called as a read.
const forwarders: Record<PropertyKey, unknown> = {}
for (const key of MEMBER_KEYS)
    forwarders[key] = function forward(
        this: Forwarder,
        ...given: unknown[]
    ): unknown {
        const instance = instanceOf(this[FILED])
        return (instance[key] as (...given: unknown[]) => unknown).apply(
            instance,
            given,
        )
    }
const FORWARDING_PROTOTYPE = brandedPrototype(forwarders)
Object.defineProperty(FORWARDING_PROTOTYPE, CELL, {
    get(this: Forwarder): unknown {
        return instanceOf(this[FILED])[CELL]
    },
})

// Whether a value built here has to be a forwarder: a server is filing values, no request is
// current, and the value did not opt out through `global` (11.34).
export function outsideScope(global: boolean): boolean {
    const provider = SCOPING.provider
    return !global && provider !== null && provider.current() === undefined
}

export function scoped(make: () => unknown): unknown {
    const filed = new Filed(make)
    // A keyed value, carrying both, or any other value, carrying neither.
    const home = filed.home as { [KEYED_BRAND]?: true } & Partial<
        Gated<unknown>
    >
    if (home[KEYED_BRAND] === true) {
        // THE KEYED FACE: a reach, the four statics and the entries, each the current instance's —
        // and the `args` gate, which every instance was declared with.
        const keyed = Object.assign(
            (args: unknown): unknown =>
                (instanceOf(filed) as unknown as (args: unknown) => unknown)(
                    args,
                ),
            {
                [KEYED_BRAND]: true,
                [ARGS_GATE]: home[ARGS_GATE],
                [FILED]: filed,
            },
        ) satisfies Gated<unknown>
        const members = keyed as unknown as Record<string, unknown>
        for (const name of SELECTION_MEMBERS)
            members[name] = (pattern?: unknown): unknown =>
                (instanceOf(filed)[name] as (pattern?: unknown) => unknown)(
                    pattern,
                )
        Object.defineProperty(keyed, 'entries', {
            get: (): unknown => instanceOf(filed).entries,
        })
        return keyed
    }
    const read = function readScoped(): unknown {
        return (instanceOf(filed) as unknown as () => unknown)()
    } as unknown as Forwarder
    Object.setPrototypeOf(read, FORWARDING_PROTOTYPE)
    read[FILED] = filed
    return read
}

// Whether `value` is request-local on this server — built without `global`, outside every request.
export function isForwarder(value: unknown): boolean {
    return (value as Partial<Forwarder> | null)?.[FILED] !== undefined
}
