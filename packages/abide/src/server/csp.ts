// A content security policy as one rung, because the half an app cannot write is the half abide knows.
//
// The split this file exists to make: abide knows what IT put inline — the patch script, the scoped
// `<style>` blocks — and stamps every one with `nonce()`. It cannot know where an app loads images
// from, or which payment processor a form posts to. So the baseline below is the part that is true of
// every abide app, and `sources` is the part that is not.
//
// Opt-in rather than on by default. Every directive here can break an app that had a reason abide
// cannot see — an embedded page, a CDN for fonts — and a security header that turns a working app
// into a blank screen on upgrade is one nobody trusts again.

import type { Middleware } from './lifecycle.ts'
import { nonce } from './scopes.ts'

/**
 * The directives abide can state for any app, and what each is holding.
 *
 * `'self'` throughout, because that is where an abide app's own things are: the bundle is served from
 * this origin under `/__abide/client/`, and so are `/__abide/rpc/**` and `/__abide/socket/**`.
 *
 * `script-src` carries no `'unsafe-inline'`. It does not need one — the two inline scripts a document
 * can contain are `patchScript` and the `$p(<id>)` call per deferred subtree, and both are stamped.
 * Note that a browser honouring the nonce IGNORES `'unsafe-inline'` if it is also present, which is
 * the mechanism that makes an injected `<script>` fail while abide's own runs.
 *
 * `style-src-attr: 'unsafe-inline'` is the one weakened line, and it is weakened deliberately: a
 * `style=` attribute cannot carry a nonce, and this codebase's own rule is that `style=` is where a
 * value COMPUTED AT RUNTIME goes — a measured width, a transform from state. A baseline that broke
 * that would be a baseline every app has to override on its first day. An app with no runtime-computed
 * styles passes `'style-src-attr': []` and gets a policy with no `'unsafe-inline'` anywhere in it.
 *
 * `object-src`/`base-uri`/`frame-ancestors`/`form-action` are the four that cost a working app nothing
 * to state and each close a real door: plugin content, a `<base>` rewriting every relative URL,
 * clickjacking, and a form posting the page's own fields to somewhere else.
 */
const BASELINE: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    // `data:` because an inline SVG icon is the most ordinary thing on a page, and a baseline that
    // broke every one of them would be overridden by every app rather than read by any.
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'style-src-attr': ["'unsafe-inline'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
}

/** The two the nonce goes on: the only directives abide's own inline output is governed by. */
const STAMPED = ['script-src', 'style-src']

/**
 * The part of the baseline that ships whether or not an app installs `csp()`, on every document.
 *
 * The opt-in argument above is about the directives that say where a resource may be LOADED from: get
 * one of those wrong for an app abide cannot see and the page is blank, and a header that does that
 * once is a header nobody turns on again. These two say nothing about loading. `object-src 'none'`
 * refuses plugin content, which no abide app has; `base-uri 'self'` refuses a `<base>` that would
 * silently repoint every relative URL on the page, which is a rewrite of the app rather than a part
 * of it. Neither can blank a working app, so neither has to be asked for.
 *
 * The other two the baseline calls free are NOT here, and this app is the counterexample for one of
 * them: `/demos` frames the fleet, so `frame-ancestors 'none'` would break abide's own dogfood — which
 * is why `app.ts` passes `'self'`. `form-action 'self'` is the same shape one step out: an app posting
 * to a payment processor is ordinary, and abide cannot see that either. Both stay in `csp()`.
 *
 * A constant rather than a per-request join: nothing here takes the nonce. `csp()` REPLACES the header
 * wholesale, and its baseline is a superset, so an app that installs it loses nothing stated here.
 */
export const ALWAYS_POLICY = "object-src 'none'; base-uri 'self'"

/**
 * The policy rung.
 *
 * `sources` REPLACES a directive rather than adding to it, which is the rule that makes the result
 * readable: what you pass is what that directive says. A name the baseline does not have is added; an
 * empty array drops the directive entirely.
 *
 * What you cannot do through here is lose the nonce — it is appended to `script-src` and `style-src`
 * after your sources are applied, because a policy without it does not run abide's own patch script,
 * and a page that suspends would then never swap a panel in. An app that genuinely wants a different
 * policy writes the header itself; `headersFor` takes a caller's own over anything abide sets.
 *
 * ```ts
 * export const middleware = [csp()]
 * export const middleware = [csp({ 'connect-src': ["'self'", 'https://api.stripe.com'] })]
 * export const middleware = [csp({ 'style-src-attr': [] })]
 * ```
 */
export function csp(sources: Record<string, string[]> = {}): Middleware {
    // Everything that does not depend on the nonce, joined ONCE at boot rather than per request: a
    // rung runs on every request this process serves, and the policy is fixed for its lifetime.
    const directives: Record<string, string[]> = { ...BASELINE, ...sources }
    let fixed = ''
    for (const name in directives) {
        const values = directives[name] as string[]
        if (values.length === 0 || STAMPED.includes(name)) continue
        fixed += `${name} ${values.join(' ')}; `
    }
    // The stamped two are held apart so a request pays one join over two directives, not eleven.
    const stamped: [string, string][] = []
    for (const name of STAMPED) {
        const values = directives[name]
        if (values !== undefined && values.length > 0) stamped.push([name, values.join(' ')])
    }

    return async (next) => {
        const answered = await next()
        // A document is the only thing with inline anything to authorise. A policy on a JSON refusal
        // is a header nothing reads, and asking for a nonce there would spend entropy per endpoint
        // call to produce it.
        if (answered.headers.get('content-type')?.startsWith('text/html') !== true) return answered
        // Set on the way OUT, and it still reaches the markup: a streamed document's body runs inside
        // this request's scope, so the render reads back the same memoized value asked for here
        // whichever of the two happens to ask first.
        const stamp = nonce()
        let policy = fixed
        for (const [name, values] of stamped) policy += `${name} ${values} 'nonce-${stamp}'; `
        answered.headers.set('content-security-policy', policy.trimEnd())
        return answered
    }
}
