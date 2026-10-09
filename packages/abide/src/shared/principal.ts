// SECTION 26 — WHO IS CALLING, on both sides. Each member is its own `Reactive` (26.1) and the identity
// members read ONE document, resolved once per request (26.2, 26.14): the server resolves it from the
// sealed cookie (`#server/principal.ts`, which `installServer` fills `PRINCIPAL` with), and a browser loads it from
// `/__abide/principal` — the handler abide mounts there, seeded as any handler is (26.17).
//
// THE MEMBERS ARE BUILT ON FIRST ACCESS. A body runs when its value is built, so members built at
// import would load the document on every page whether anything read it or not.

import { PRINCIPAL_ADDRESS } from './ADDRESSES.ts'
import { type Failed, isFailed } from './Failed.ts'
import { PRINCIPAL_ROTATED } from './PRINCIPAL_ROTATED.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { seededDocument } from './seededDocument.ts'

/**
 * The principal document: whether the caller is authenticated, and its claims.
 *
 * AN INTERFACE, as `Config` (27.12) and `Health` (25.4) are, so an app declares what its `onPrincipal` resolves to by merging into it, and
 * `principal.resolved()` reads those fields typed. A claim is absent for a caller who is not signed in,
 * so one declared without `?` is a promise the app is making about every reader.
 */
export interface Principal {
    [claim: string]: unknown
    authenticated: boolean
    expiresAt?: string | undefined
    error?: Failed<string, unknown> | undefined
}

/** A browser's defaults for the slots `principal` reads through. */
export const BROWSER_PRINCIPAL: {
    document: () => Principal | Promise<Principal>
    caller: () => string
    set: (claims: unknown) => Promise<void>
    clear: () => void
} = {
    // 26.17 — seeded as any handler's answer is. 26.23 — a refused one is the unauthenticated
    // document carrying the refusal, as a resolver that failed is on the server (26.3), so
    // `principal` is never without a document (26.10). 41.27 — settled at once where the seed is.
    document: () => {
        const seeded = seededDocument<Principal>(PRINCIPAL_ADDRESS)
        return seeded instanceof Promise
            ? seeded.then(documentOf)
            : documentOf(seeded)
    },
    // 26.22.
    caller: () => {
        throw new Error(
            "abide: principal.caller was read in a browser. Which browser is calling is the server's to know. RULEBOOK 26.22.",
        )
    },
    set: () =>
        Promise.reject(
            new Error(
                'abide: principal.set runs where the sealed cookie is written — call it in a handler.',
            ),
        ),
    clear: () => {
        throw new Error(
            'abide: principal.clear runs where the sealed cookie is written — call it in a handler.',
        )
    },
}

/**
 * The slots `principal` reads through: a browser's defaults, which the server replaces
 * (`#server/principal.ts`).
 */
export const PRINCIPAL: typeof BROWSER_PRINCIPAL = { ...BROWSER_PRINCIPAL }

function documentOf(seeded: Principal | Failed<string, unknown>): Principal {
    return isFailed(seeded)
        ? { authenticated: false, expiresAt: undefined, error: seeded }
        : seeded
}

type Members = {
    document: Reactive<Principal>
    authenticated: Reactive<boolean>
    expiresAt: Reactive<string | undefined>
    error: Reactive<Failed<string, unknown> | undefined>
    resolved: Reactive<Principal>
    caller: Reactive<string>
}

let members: Members | undefined

/** The principal's members, each its own `Reactive`, built on first access. */
export function principalMembers(): Members {
    if (members !== undefined) return members
    const document = ambient(() =>
        PRINCIPAL.document(),
    ) as unknown as Reactive<Principal>
    members = {
        document,
        authenticated: ambient(
            () => document().authenticated,
        ) as unknown as Reactive<boolean>,
        expiresAt: ambient(() => document().expiresAt) as unknown as Reactive<
            string | undefined
        >,
        error: ambient(() => document().error) as unknown as Reactive<
            Failed<string, unknown> | undefined
        >,
        resolved: ambient(() => document()) as unknown as Reactive<Principal>,
        // 26.5 — NEEDS NO RESOLUTION: read off its own cookie, apart from the document.
        caller: ambient(() =>
            PRINCIPAL.caller(),
        ) as unknown as Reactive<string>,
    }
    // A SIGN-IN OR SIGN-OUT A HANDLER ANSWERED reloads the document, and every member reads
    // through it. A REFRESH, not an invalidate: 7.4 keeps the document a click handler reads
    // served until the new one lands.
    PRINCIPAL_ROTATED.current = () => document.refresh()
    return members
}

/** Who is calling (26.1): each member a `Reactive`, and `set` / `clear` for the sealed cookie. */
export const principal = {
    get authenticated(): Reactive<boolean> {
        return principalMembers().authenticated
    },
    get expiresAt(): Reactive<string | undefined> {
        return principalMembers().expiresAt
    },
    get error(): Reactive<Failed<string, unknown> | undefined> {
        return principalMembers().error
    },
    get resolved(): Reactive<Principal> {
        return principalMembers().resolved
    },
    get caller(): Reactive<string> {
        return principalMembers().caller
    },
    set(claims: unknown): Promise<void> {
        return PRINCIPAL.set(claims)
    },
    clear(): void {
        PRINCIPAL.clear()
    },
}
