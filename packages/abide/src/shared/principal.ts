// SECTION 26 — WHO IS CALLING, on both sides. Each member is its own `Reactive` (26.1) and the identity
// members read ONE document, resolved once per request (26.2, 26.14): the server resolves it from the
// sealed cookie (`#server/principal.ts`, which fills `PRINCIPAL`), and a browser loads it from
// `/__abide/principal`.
//
// THE MEMBERS ARE BUILT ON FIRST ACCESS. A body runs when its value is built, so members built at
// import would load the document on every page whether anything read it or not.

import type { Failed } from './Failed.ts'
import { mounted } from './mount.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'

export type Principal = {
    authenticated: boolean
    expiresAt?: string | undefined
    error?: Failed<string, unknown> | undefined
    [claim: string]: unknown
}

export const PRINCIPAL_ADDRESS = '/__abide/principal'

export const PRINCIPAL: {
    document: () => Principal | Promise<Principal>
    caller: () => string
    set: (claims: unknown) => Promise<void>
    clear: () => void
} = {
    document: async () =>
        (await fetch(mounted(PRINCIPAL_ADDRESS))).json() as Promise<Principal>,
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
