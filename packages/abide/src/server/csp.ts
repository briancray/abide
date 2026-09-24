// SECTION 29 — THE CONTENT SECURITY POLICY, as one rung (29.1) an app puts in its `middleware`. The
// policy is the baseline (29.5) with the app's `sources` over it, and it goes on a document alone
// (29.2): a policy on JSON or a script restricts nothing, since nothing is rendered from it.
//
// THE NONCE IS MINTED BEFORE THE ROUTE RUNS, so a page reading `csp.nonce` while it renders reads
// the one the header already carries — the header is written before the body streams.

import type { Middleware } from '#shared/Middleware.ts'
import { randomToken } from './randomToken.ts'
import { EARLY_CALL_HASH } from './render.ts'
import { within } from './requestScope.ts'

// 29.5.
const BASELINE: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'style-src-attr': ["'unsafe-inline'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
}

// 29.3, 29.4 — this response's nonce, readable in a request scope alone.
function nonce(): string {
    const scope = within('csp.nonce')
    scope.nonce ??= randomToken(16, 'base64')
    return scope.nonce
}

function policy(
    sources: Record<string, string[]> | undefined,
): (nonce: string) => string {
    // 29.6 — A DIRECTIVE GIVEN IS REPLACED, not added to; 29.7 — an empty one is dropped; 29.8 — one
    // the baseline lacks is added. Merged once, when the rung is built.
    const merged: Record<string, string[]> = { ...BASELINE }
    for (const [name, values] of Object.entries(sources ?? {}))
        if (values.length === 0) delete merged[name]
        else merged[name] = values
    // 29.9 — the inline `render` emits is permitted by its hash, whatever `script-src` became.
    const script = merged['script-src']
    if (script !== undefined)
        merged['script-src'] = [...script, EARLY_CALL_HASH]
    const directives = Object.entries(merged)
    return (given) => {
        let header = ''
        for (const [name, values] of directives) {
            if (header !== '') header += '; '
            header += `${name} ${values.join(' ')}`
            if (name === 'script-src') header += ` 'nonce-${given}'`
        }
        return header
    }
}

export const csp = Object.assign(
    (
        sources?: Record<string, string[]>,
    ): Middleware<{ request: Request }, Response> => {
        const written = policy(sources)
        return async (next) => {
            const minted = nonce()
            const answer = await next()
            // 29.2.
            if (
                answer.headers.get('content-type')?.startsWith('text/html') ===
                true
            )
                answer.headers.set('content-security-policy', written(minted))
            return answer
        }
    },
    { nonce },
)
