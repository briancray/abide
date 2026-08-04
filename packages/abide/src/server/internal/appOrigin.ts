// The app's own public origin, as the two ORIGIN GATES see it: the CSRF Origin/Referer check
// (`router.csrfReject`) and the CSWSH WebSocket-upgrade check (`socketMux.socketOriginAllowed`).
// Both compare a claimed origin against `APP_URL`, and both used to parse it themselves — per
// mutating request and per upgrade — for a value that is fixed for the process.
//
// Parsed once per DISTINCT `APP_URL` rather than memoised outright, because `abide dev`'s port hop
// REWRITES `Bun.env.APP_URL` after this module loads (`cli/serve.ts`) precisely so these two gates
// keep naming the port the server actually bound.
//
// `configured` and `origin` are separate because an unset `APP_URL` and an unparseable one are not
// the same answer: unset means the gate is disabled (legitimate in dev), unparseable means it is
// enabled and nothing can satisfy it.
export interface AppOrigin {
    readonly configured: boolean
    readonly origin: string | undefined
}

const UNCONFIGURED: AppOrigin = { configured: false, origin: undefined }

let cachedUrl: string | undefined
let cached: AppOrigin = UNCONFIGURED

export function appOrigin(): AppOrigin {
    const appUrl = Bun.env.APP_URL
    if (appUrl === undefined || appUrl.length === 0) return UNCONFIGURED
    if (appUrl !== cachedUrl) {
        cachedUrl = appUrl
        let origin: string | undefined
        try {
            origin = new URL(appUrl).origin
        } catch {
            origin = undefined
        }
        cached = { configured: true, origin }
    }
    return cached
}
