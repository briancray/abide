// SECTION 29 — THE CONTENT SECURITY POLICY, by one name on both sides. The rung and the nonce a
// response carries are the server's (`#server/csp.ts`, which `installServer` fills `CSP` with); a browser has no response to
// mint one for, so `csp.nonce` answers the one its document was served with, which is what a
// binding that wrote it on the server hydrates to.

import type { Middleware } from './Middleware.ts'

type Rung = Middleware<{ request: Request }, Response>

/**
 * The server's content-security-policy half, as slots `#server/installServer.ts` fills from
 * `#server/csp.ts`.
 *
 * Until it does, `rung` refuses and `nonce` reads the document's.
 */
export const CSP: {
    rung: (sources: Record<string, string[]> | undefined) => Rung
    nonce: () => string
} = {
    rung: () => {
        throw new Error(
            'abide: csp is a server rung, and it was run in a browser. RULEBOOK 29.1.',
        )
    },
    nonce: documentNonce,
}

/**
 * The nonce this document's scripts were served with, or `''`.
 *
 * 29.11. A browser blanks the `nonce` ATTRIBUTE once the document is parsed and keeps the value in
 * the element's `nonce` property, so the property is read first; a DOM with no such property (the
 * emulator the tests render into) still has the attribute.
 */
export function documentNonce(): string {
    const script = document.querySelector<HTMLScriptElement>('script[nonce]')
    return script?.nonce || script?.getAttribute('nonce') || ''
}

/**
 * A middleware rung that sets the content security policy, and `csp.nonce()` for the current one.
 *
 * THE RUNG IS BUILT ON ITS FIRST REQUEST, because an app's `middleware` can be read before the
 * server half has filled `CSP`: `app.ts` is one more module, and nothing orders it after that one.
 */
export const csp = Object.assign(
    (sources?: Record<string, string[]>): Rung => {
        let built: Rung | undefined
        return (next, ctx) => {
            built ??= CSP.rung(sources)
            return built(next, ctx)
        }
    },
    { nonce: (): string => CSP.nonce() },
)
