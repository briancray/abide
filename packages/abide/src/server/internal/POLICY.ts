// The half of the content security policy that ships whether or not an app installs `csp()`.
//
// A leaf because it crosses from the module that owns the policy into the one every other server
// file imports for `json` / `refuse` / `failed`. `responses.ts` naming it on `csp.ts` was an edge
// onto the whole baseline — eleven directives, `STAMPED`, and `csp()` itself — plus `csp.ts`'s own
// edge onto `scopes.ts`, for one string on a document header.

/**
 * The opt-in argument in `csp()` is about the directives that say where a resource may be LOADED
 * from: get one of those wrong for an app abide cannot see and the page is blank, and a header that
 * does that once is a header nobody turns on again. These two say nothing about loading.
 * `object-src 'none'` refuses plugin content, which no abide app has; `base-uri 'self'` refuses a
 * `<base>` that would silently repoint every relative URL on the page, which is a rewrite of the app
 * rather than a part of it. Neither can blank a working app, so neither has to be asked for.
 *
 * The other two the baseline calls free are NOT here, and this repo's own app is the counterexample
 * for one of them: a `visit` case frames a real route of its own app to watch what the response did,
 * so `frame-ancestors 'none'` would break abide's own dogfood — which is why `app.ts` passes `'self'`.
 * `form-action 'self'` is the same shape one step out: an app posting to a payment processor is
 * ordinary, and abide cannot see that either. Both stay in `csp()`.
 *
 * A constant rather than a per-request join: nothing here takes the nonce. `csp()` REPLACES the
 * header wholesale, and its baseline is a superset, so an app that installs it loses nothing here.
 */
export const ALWAYS_POLICY = "object-src 'none'; base-uri 'self'"
