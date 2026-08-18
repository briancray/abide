// Where the app is mounted, when it is not at the root of its origin.
//
// One value, derived from `APP_URL`'s PATH — `https://abide.com/v2` mounts the app at `/v2`. Not a
// knob of its own, because it is not a second fact: an operator who has said where the app is served
// has already said this, and two variables that must agree are one that eventually does not.
//
// EVERYTHING abide addresses is under it — the app's own routes and every `/__abide/` endpoint alike
// — because a sub-path mount is a proxy forwarding ONE prefix, and nothing outside that prefix
// reaches the process at all.
//
// Two spaces, and the whole of the rule is which side of the wire a path is on. APP SPACE is what a
// route table, a pattern, `route().name` and an rpc id are written in, and it never carries the base;
// a page moved under a mount is not a page that was renamed. BROWSER SPACE is what a document, an
// `href`, a `fetch` and the address bar carry, and it always does. `mounted` and `unmounted` below
// are the only two crossings, so there is one place to read to know which space a path is in.
//
// Installed rather than read: `#shared` cannot ask `config()` without pulling the server into every
// browser bundle, and the client is not the lane that knows — it is TOLD, by the document it was
// served in. See `useMountBase`'s two callers.

/**
 * The `<meta name>` a served document carries its base in, for the client to read back.
 *
 * Here rather than beside the shell that writes it, for the reason `PATHS.ts` gives about
 * `HEALTH_PATH`: the two ends are in different packages, and a name only one side knows is a name the
 * two can spell differently.
 */
export const MOUNT_META = 'abide-mount'

/** Normalised: `''` at the root, else a leading slash and no trailing one. */
let BASE = ''

/**
 * `''` when the app is at the root of its origin, which is the default and the overwhelming case.
 *
 * Exported for the callers that need the VALUE rather than a crossing: the shell writes it into the
 * document for the client to read back, `abide dev` re-spells `APP_URL` from the bound origin, and
 * `router.ts`'s `lookup` and `mountedTarget` each ask "is there a mount at all" before doing work.
 */
export function mountBase(): string {
    return BASE
}

/**
 * Declare where the app is mounted. `abide/server` calls this from `APP_URL`, `abide/ui` from what the
 * document carries — the same two-edged install `useHrefSource` and `useHistorySink` have, and for the
 * same reason: the policy is here, and each lane knows the answer a different way.
 *
 * Idempotent and cheap, so `config.invalidate()` re-declaring the same value costs a compare.
 */
export function useMountBase(path: string): void {
    // A whole URL is accepted because `APP_URL` is one, and a bare path because the document carries
    // only that. Anything else — `abide.com`, an empty string, a value that does not parse — is the
    // ROOT rather than a guess: a mount is the one thing here that silently misaddresses every asset
    // and every endpoint if it is wrong, so a value that did not clearly say a path says nothing.
    let base = ''
    if (path.indexOf('://') !== -1) base = URL.parse(path)?.pathname ?? ''
    else if (path.charCodeAt(0) === 47) base = path
    while (base.length > 1 && base.charCodeAt(base.length - 1) === 47) base = base.slice(0, -1)
    BASE = base === '/' ? '' : base
}

/**
 * APP SPACE -> BROWSER SPACE. The path an app wrote, as the browser has to ask for it.
 *
 * The unmounted app is one string compare and the path back — no allocation, no concatenation. That
 * matters here rather than as a preference: this is `url()`'s last line, and `url()` is called per row.
 */
export function mounted(path: string): string {
    if (BASE === '') return path
    return path === '/' ? BASE : BASE + path
}

/**
 * BROWSER SPACE -> APP SPACE. What the app calls the thing the browser asked for.
 *
 * A path OUTSIDE the mount is handed back UNCHANGED rather than refused, which is the honest answer
 * for the caller this has: routing, where an unmatched path is already a 404 and a second failure
 * mode beside it would say nothing new.
 *
 * That is exactly why the prefix dispatchers do not use this — they use `reserved` below, where "not
 * under the mount" and "not abide's" are one answer.
 */
export function unmounted(path: string): string {
    if (BASE === '') return path
    if (!path.startsWith(BASE)) return path
    const rest = path.slice(BASE.length)
    if (rest === '') return '/'
    // The boundary is a SEGMENT boundary, so a mount at `/v2` does not swallow `/v20/thing`. Checked
    // on the character rather than by re-testing a `${BASE}/` prefix, which would build a string per
    // call on a path walked per request.
    return rest.charCodeAt(0) === 47 ? rest : path
}

/**
 * BROWSER SPACE -> APP SPACE for a RESERVED path: the app-space path when the browser asked for one
 * under the mount AND under `prefix`, else `null`.
 *
 * The crossing every prefix dispatcher wants, and the reason it is not `unmounted` plus a test. Those
 * two answer different questions and only this one folds them: `unmounted` hands a path outside the
 * mount back UNCHANGED, so `/__abide/reload.js` at the origin root of an app mounted at `/v2` comes
 * back still starting with the reserved prefix and reads as abide's. Serving it there is a dev client
 * — or an endpoint — answering at an address the app is not mounted at, which is the failure a mount
 * has: it is silent, and every route that got it right disagrees with the one that did not.
 *
 * Written once for the three callers rather than inline at each, because that divergence is what
 * having it inline at each produced.
 */
export function reserved(pathname: string, prefix: string): string | null {
    // The mount tested BEFORE the prefix is stripped, which is the whole of the fold: at the root
    // `BASE` is `''` and this is one always-true compare, so the common app pays nothing for it.
    if (!pathname.startsWith(BASE)) return null
    const path = pathname.slice(BASE.length)
    return path.startsWith(prefix) ? path : null
}

/**
 * A reserved path under a base URL that may itself carry a mount.
 *
 * `new URL('/__abide/schema', 'https://host/v2')` throws the mount away and asks an address the app
 * is not serving, which is the bug `abide logs` found first — so the path is resolved RELATIVE, and
 * the base is given the trailing slash that makes a relative join keep its last segment.
 *
 * The caller's half of the same crossing `mounted` is on this side: `mounted` answers for an app that
 * knows its own base, and this for one asking a base somebody else typed.
 */
export function under(base: string, path: string): string {
    return new URL(path.startsWith('/') ? path.slice(1) : path, base.endsWith('/') ? base : `${base}/`).href
}
