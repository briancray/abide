// SECTION 26 — WHO IS CALLING, on both sides. Each member is its own `Reactive` (26.1) and the identity
// members read ONE document, resolved once per request (26.2, 26.14): the server resolves it from the
// sealed cookie (`#server/principal.ts`, which fills `PRINCIPAL`), and a browser loads it from
// `/__abide/principal` — the handler abide mounts there, seeded as any handler is (26.17).
//
// THE MEMBERS ARE BUILT ON FIRST ACCESS. A body runs when its value is built, so members built at
// import would load the document on every page whether anything read it or not.

import { PRINCIPAL_ADDRESS } from './ADDRESSES.ts'
import type { Failed } from './Failed.ts'
import { mounted } from './mount.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { rpcRequest } from './rpcRequest.ts'
import { takeEarlyCall } from './takeEarlyCall.ts'

/** The principal document: whether the caller is authenticated, and its claims. */
export type Principal = {
    authenticated: boolean
    expiresAt?: string | undefined
    error?: Failed<string, unknown> | undefined
    [claim: string]: unknown
}

/**
 * The slots `principal` reads through: a browser's defaults, which the server replaces
 * (`#server/principal.ts`).
 */
export const PRINCIPAL: {
    document: () => Principal | Promise<Principal>
    caller: () => string
    set: (claims: unknown) => Promise<void>
    clear: () => void
} = {
    // 26.17 — THE CALL A HANDLER'S `wire` MAKES, less the follow: the page's early-call script
    // started it where a render read the principal, and it is taken from there (41.21) before it is
    // fetched. Not followed over the mux, which carries app handlers' productions and has no
    // principal to send.
    document: async () => {
        const request = rpcRequest('GET', mounted(PRINCIPAL_ADDRESS), undefined)
        const early = takeEarlyCall(request.key)
        if (early !== undefined) {
            await early.promise
            if (early.text !== undefined)
                return JSON.parse(early.text) as Principal
        }
        return (
            await fetch(request.url, request.init)
        ).json() as Promise<Principal>
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

type Members = {
    document: Reactive<Principal>
    authenticated: Reactive<boolean>
    expiresAt: Reactive<string | undefined>
    error: Reactive<Failed<string, unknown> | undefined>
    resolved: Reactive<unknown>
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
        resolved: ambient(() => document()) as unknown as Reactive<unknown>,
        // 26.5 — NEEDS NO RESOLUTION: read off its own cookie, apart from the document.
        caller: ambient(() =>
            PRINCIPAL.caller(),
        ) as unknown as Reactive<string>,
    }
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
    get resolved(): Reactive<unknown> {
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
