// 11.32, 11.38 AND 11.66 — A VALUE BUILT OUTSIDE EVERY SCOPE, ON A SERVER. A module's `reactive` is built
// once, when the module is first imported, and every request after that reaches the same object —
// so the value it hands back is a FORWARDER: outside a request it is the value built at import
// (the HOME), and inside one it is an instance of its own, built the first time that request
// reaches it and dropped with the request — or, where building the home started a load, built up
// front by every render that request makes (41.34), as a browser builds it at import.
//
// A FORWARDER RATHER THAN A SCOPE LOOKUP IN THE CORE. A read captures its cell and nothing else,
// and it is the hottest path in the design; a browser never builds a forwarder, so what the read
// costs there is exactly what it cost before, and the lookup is paid on a server alone.
//
// THE INSTANCE IS A WHOLE VALUE, not a cell under the forwarder. A value moves between prototypes
// while it adopts (`ADOPTING_PROTOTYPE`), and one callable shared by every request would be moved
// for all of them by the first.

import { contractOf, type Gated } from './argsContract.ts'
import type { Callable } from './cellShape.ts'
import { KEYED_BRAND } from './KEYED_BRAND.ts'
import { forwardingPrototype } from './Reactive.ts'
import { currentScope, runInScope, SCOPING } from './scoping.ts'
import { SELECTION_MEMBERS } from './SELECTION_MEMBERS.ts'
import { owning, unowned } from './watch.ts'

const UNBUILT: unique symbol = Symbol('abide.unbuilt')

/**
 * What a forwarder resolves through: the home, and how to build the same value again in a scope.
 *
 * 11.70 AND 16.64 — A HANDLER'S HOME, AND AN UNKEYED VALUE'S WITH A `store`, IS BUILT WHERE IT IS
 * FIRST REACHED, and every other value's where it is declared — or, declared while the app is
 * entered, once it has (11.82). Building a value starts its body (1.7) and reads its store (8.14),
 * and at import that ran a handler for a request nobody had made, and a store reading `cookies()`
 * where there is no request.
 *
 * A `global` handler (11.34) is filed only to be built late: every request reaches the home, built
 * outside each of them, so it is the one value its option says it is.
 */
class Filed {
    home: unknown
    make: () => unknown
    global: boolean
    /**
     * 12.17 — whether the declaration had an owner. A home declared with none — a module's, which is
     * every handler's — is the process's, and is built as one wherever it is first reached.
     */
    declaredOwned: boolean
    /**
     * 11.72 — the scope whose instance `make` is building now, or the `Filed` itself for the home,
     * and `undefined` where nothing is. A body reaching the value it is the first run of reaches
     * this, where `instances` is still empty and a read built another instance, whose body reached
     * it again — until the stack ran out.
     */
    building: object | undefined

    constructor(make: () => unknown, lazy: boolean, global: boolean) {
        this.make = make
        this.building = undefined
        // OUTSIDE EVERY SCOPE even where an `ambient` is first built inside a request (`principal`'s
        // members): built there, the home read that request's instances for the life of the process.
        this.home = lazy ? UNBUILT : runInScope(undefined, make, undefined)
        this.global = global
        this.declaredOwned = owning()
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
            filed.home = built(filed, filed, () =>
                filed.declaredOwned
                    ? runInScope(undefined, filed.make, undefined)
                    : unowned(() =>
                          runInScope(undefined, filed.make, undefined),
                      ),
            )
        }
        return filed.home as Record<PropertyKey, unknown>
    }
    let instance = scope.instances.get(filed)
    if (instance === undefined) {
        instance = built(filed, scope, filed.make)
        scope.instances.set(filed, instance)
    }
    return instance as Record<PropertyKey, unknown>
}

/**
 * 11.72 — what `make` builds for `building`, refusing a read that reaches it again before it has —
 * a body reading the value it is the first run of, which a browser refuses as the binding's TDZ.
 */
function built(filed: Filed, building: object, make: () => unknown): unknown {
    if (filed.building === building)
        throw new ReferenceError(
            'abide: a reactive read itself in its first run, before it was built. RULEBOOK 11.72.',
        )
    const outer = filed.building
    filed.building = building
    try {
        return make()
    } finally {
        filed.building = outer
    }
}

// Under `Function.prototype` for `MEMBER_PROTOTYPE`'s reason: the forwarder is called as a read.
const FORWARDING_PROTOTYPE = forwardingPrototype<Forwarder>(
    (forwarder) => instanceOf(forwarder[FILED]) as unknown as Callable,
)

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
    const home = filed.home as { [KEYED_BRAND]?: true | undefined } & Partial<
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
 * 11.82 — the forwarders declared while the app is entered, their homes unbuilt, or `null` where the
 * app is not being entered. An app's server blocks import its modules ahead of their own bodies, so
 * a home built at import ran its body (1.7) — a handler, in-process — before any `onConfig` was filed.
 */
let enteringHomes: unknown[] | null = null

/** Whether a home declared now waits for `enteredHomes`. */
export function entering(): boolean {
    return enteringHomes !== null
}

/** Keeps `forwarder`, declared while the app is entered, for `enteredHomes` to build. */
export function deferHome(forwarder: unknown): void {
    enteringHomes?.push(forwarder)
}

/** Opens 11.82's window: every home declared from here waits for `enteredHomes`. */
export function deferHomes(): void {
    enteringHomes ??= []
}

/**
 * Closes 11.82's window: builds each home it kept, in the order declared, and hands each to `filed`
 * — or, with no `filed`, an entry that failed, leaves each unbuilt, built where it is first reached.
 */
export function enteredHomes(
    filed: ((forwarder: unknown) => void) | undefined,
): void {
    const homes = enteringHomes ?? []
    enteringHomes = null
    if (filed === undefined) return
    for (const forwarder of homes) {
        instanceOf((forwarder as Forwarder)[FILED])
        filed(forwarder)
    }
}

/** 41.34 — builds the instance `value` forwards to in the scope that is current, as a first read does. */
export function buildHere(value: unknown): void {
    instanceOf((value as Forwarder)[FILED])
}

/**
 * Whether the value `value` forwards to is built for the scope that is current — always, for a
 * value that is no forwarder. Asking builds nothing, where `instanceOf` builds what it finds unbuilt.
 */
export function builtHere(value: unknown): boolean {
    const filed = (value as Partial<Forwarder> | null)?.[FILED]
    if (filed === undefined) return true
    const scope = filed.global ? undefined : currentScope()
    return scope === undefined
        ? filed.home !== UNBUILT
        : scope.instances.has(filed)
}

/**
 * Whether `value` is request-local on this server — built without `global`, outside every request.
 */
export function isForwarder(value: unknown): boolean {
    const filed = (value as Partial<Forwarder> | null)?.[FILED]
    return filed !== undefined && !filed.global
}
