// 11.32, 11.38 AND 11.67 — A VALUE BUILT OUTSIDE EVERY SCOPE, ON A SERVER. A module's `reactive` is built
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

import { contractOf, type Gated } from './argsContract.ts'
import { CELL } from './CELL.ts'
import { KEYED_BRAND } from './KEYED_BRAND.ts'
import { brandedPrototype, MEMBER_KEYS, signalMoved } from './Reactive.ts'
import { SELECTION_MEMBERS } from './SELECTION_MEMBERS.ts'
import { currentScope, runInScope, SCOPING } from './scoping.ts'
import { newTracked, TRACKING, type Tracked, trackProbe } from './tracking.ts'

const UNBUILT: unique symbol = Symbol('abide.unbuilt')

/**
 * What a forwarder resolves through: the home, and how to build the same value again in a scope.
 *
 * 11.71 AND 16.64 — A HANDLER'S HOME, AND AN UNKEYED VALUE'S WITH A `store`, IS BUILT WHERE IT IS
 * FIRST REACHED, and every other value's where it is declared. Building a value starts its body
 * (1.7) and reads its store (8.14), and at import that ran a handler for a request nobody had made,
 * and a store reading `cookies()` where there is no request.
 *
 * A `global` handler (11.34) is filed only to be built late: every request reaches the home, built
 * outside each of them, so it is the one value its option says it is.
 */
class Filed {
    home: unknown
    make: () => unknown
    global: boolean
    /**
     * 3.3, 13.19 — what a probe asked before the value was built here subscribes to, moved by the
     * build: the home's. A scope files its own in `instances` under this one as its key, and drops
     * it with the scope.
     */
    unbuilt: Tracked

    constructor(make: () => unknown, lazy: boolean, global: boolean) {
        this.make = make
        this.home = lazy ? UNBUILT : make()
        this.global = global
        this.unbuilt = newTracked()
    }
}

const FILED: unique symbol = Symbol('abide.filed')

type Forwarder = { [FILED]: Filed }

/**
 * The instance for the scope that is current, built there the first time it is reached.
 *
 * Built INSIDE the scope, so every cell it makes records that scope as its own (`Cell.scope`).
 */
function instanceOf(filed: Filed): Record<PropertyKey, unknown> {
    const scope = filed.global ? undefined : currentScope()
    if (scope === undefined) {
        if (filed.home === UNBUILT) {
            filed.home = runInScope(undefined, () => filed.make(), undefined)
            signalMoved(filed.unbuilt)
        }
        return filed.home as Record<PropertyKey, unknown>
    }
    let instance = scope.instances.get(filed)
    if (instance === undefined) {
        instance = filed.make()
        scope.instances.set(filed, instance)
        const asked = scope.instances.get(filed.unbuilt) as Tracked | undefined
        if (asked !== undefined) {
            scope.instances.delete(filed.unbuilt)
            signalMoved(asked)
        }
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

/**
 * Whether a value built here has to be a forwarder.
 *
 * It does where a server is filing values, no request is current, and the value did not opt out
 * through `global` (11.34).
 */
export function outsideScope(global: boolean): boolean {
    const provider = SCOPING.provider
    return !global && provider !== null && provider.current() === undefined
}

/**
 * A forwarder over `make`'s value: the home outside a request, one instance per request inside.
 *
 * `lazy` leaves the home unbuilt until something outside every request reaches it. Only an unkeyed
 * value can be: a keyed face carries its home's gate and defaults, and building one runs no body
 * (11.4). `global` resolves every scope to the home, and only a lazy value is filed with it.
 */
export function scoped(
    make: () => unknown,
    lazy = false,
    global = false,
): unknown {
    const filed = new Filed(make, lazy, global)
    // A keyed value, carrying both, or any other value, carrying neither.
    const home = filed.home as { [KEYED_BRAND]?: true } & Partial<
        Gated<unknown>
    >
    if (!lazy && home[KEYED_BRAND] === true) {
        // THE KEYED FACE: a reach, the four statics and the entries, each the current instance's —
        // and the `args` gate and the parameter's defaults, which every instance was declared with.
        const keyed = Object.assign(
            (args: unknown): unknown =>
                (instanceOf(filed) as unknown as (args: unknown) => unknown)(
                    args,
                ),
            contractOf(home),
            { [KEYED_BRAND]: true, [FILED]: filed },
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

/**
 * Whether the value `value` forwards to is built for the scope that is current — always, for a
 * value that is no forwarder. Asking builds nothing, where `instanceOf` builds what it finds unbuilt.
 *
 * 3.3 — AND WHERE IT IS NOT, ASKING SUBSCRIBES THE READER TO ITS BUILD: a guard that probed before
 * the first call has no cell to hear the call start from, so `disabled={save.busy()}` stayed
 * enabled through the whole write. One signal per value per scope, never one per entry (13.3).
 */
export function builtHere(value: unknown): boolean {
    const filed = (value as Partial<Forwarder> | null)?.[FILED]
    if (filed === undefined) return true
    const scope = filed.global ? undefined : currentScope()
    if (
        scope === undefined
            ? filed.home !== UNBUILT
            : scope.instances.has(filed)
    )
        return true
    const reader = TRACKING.reader
    if (reader === null) return false
    let asked = filed.unbuilt
    if (scope !== undefined) {
        asked = scope.instances.get(filed.unbuilt) as Tracked
        if (asked === undefined) {
            asked = newTracked()
            scope.instances.set(filed.unbuilt, asked)
        }
    }
    trackProbe(asked, reader)
    return false
}

/**
 * Whether `value` is request-local on this server — built without `global`, outside every request.
 */
export function isForwarder(value: unknown): boolean {
    const filed = (value as Partial<Forwarder> | null)?.[FILED]
    return filed !== undefined && !filed.global
}
