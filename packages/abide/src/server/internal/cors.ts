// CORS for RPCs that OPT IN via `crossOrigin` (rpc-core; auth.md AU8). Default is CLOSED: an RPC with
// no `crossOrigin` emits no `Access-Control-*` headers and a cross-origin mutation is rejected by the
// CSRF gate. Opting in relaxes both — the router answers the `OPTIONS` preflight and stamps the actual
// response with the negotiated Allow-* headers.
//
// `origin` allowlists the callers: omit / `true` = any origin, a string / string[] = an exact allowlist.
// With `credentials: true` the `*` wildcard is illegal per the Fetch spec, so we echo the concrete
// request Origin (and add `Vary: Origin`).

import { appendVary } from './applyResponseHeaders.ts'

const DEFAULT_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'
const DEFAULT_HEADERS = 'content-type, authorization, x-abide'
const DEFAULT_MAX_AGE = 600

export type CrossOriginOption =
    | boolean
    | {
          origin?: string | string[] | boolean
          methods?: string[]
          headers?: string[]
          credentials?: boolean
          maxAge?: number
      }

export interface NormalizedCors {
    // `true` = reflect any origin; an array = an exact allowlist.
    origins: string[] | true
    methods: string
    headers: string
    credentials: boolean
    maxAge: number
}

export function normalizeCrossOrigin(option: unknown): NormalizedCors | undefined {
    if (option === undefined || option === null || option === false) return undefined
    if (option === true)
        return {
            origins: true,
            methods: DEFAULT_METHODS,
            headers: DEFAULT_HEADERS,
            credentials: false,
            maxAge: DEFAULT_MAX_AGE,
        }
    if (typeof option !== 'object') return undefined
    const spec = option as {
        origin?: unknown
        methods?: unknown
        headers?: unknown
        credentials?: unknown
        maxAge?: unknown
    }
    let origins: string[] | true
    if (spec.origin === undefined || spec.origin === true) origins = true
    else if (spec.origin === false) return undefined
    else if (typeof spec.origin === 'string') origins = [spec.origin]
    else if (Array.isArray(spec.origin))
        origins = spec.origin.filter((value): value is string => typeof value === 'string')
    else origins = true
    return {
        origins,
        methods: Array.isArray(spec.methods) ? spec.methods.join(', ') : DEFAULT_METHODS,
        headers: Array.isArray(spec.headers) ? spec.headers.join(', ') : DEFAULT_HEADERS,
        credentials: spec.credentials === true,
        maxAge: typeof spec.maxAge === 'number' ? spec.maxAge : DEFAULT_MAX_AGE,
    }
}

// The `Access-Control-Allow-Origin` value to send for this request Origin, or undefined if the origin
// is not permitted. Without credentials an "any" policy collapses to the cacheable `*`; with
// credentials (or an allowlist) we echo the concrete origin so the caller adds `Vary: Origin`.
export function corsAllowOrigin(
    cors: NormalizedCors,
    requestOrigin: string | null,
): string | undefined {
    if (requestOrigin === null) return undefined
    if (cors.origins === true) return cors.credentials ? requestOrigin : '*'
    return cors.origins.includes(requestOrigin) ? requestOrigin : undefined
}

// Answer a CORS preflight (`OPTIONS`). A disallowed origin gets a bare 204 with NO Allow-* headers, so
// the browser blocks the follow-up request.
export function preflightResponse(cors: NormalizedCors, request: Request): Response {
    const allowOrigin = corsAllowOrigin(cors, request.headers.get('origin'))
    if (allowOrigin === undefined) return new Response(null, { status: 204 })
    const headers = new Headers({
        'access-control-allow-origin': allowOrigin,
        'access-control-allow-methods': cors.methods,
        // Advertise the CONFIGURED allowlist, not a verbatim echo of the request's
        // `Access-Control-Request-Headers` — echoing would grant whatever the caller asked for and
        // make the `headers` option decorative. `cors.headers` is always set (explicit list or default).
        'access-control-allow-headers': cors.headers,
        'access-control-max-age': String(cors.maxAge),
    })
    if (cors.credentials) headers.set('access-control-allow-credentials', 'true')
    if (allowOrigin !== '*') appendVary(headers, 'Origin')
    return new Response(null, { status: 204, headers })
}

// Stamp the actual (non-preflight) response with the negotiated Allow-* headers for an allowed origin.
export function applyCors(cors: NormalizedCors, request: Request, response: Response): void {
    const allowOrigin = corsAllowOrigin(cors, request.headers.get('origin'))
    if (allowOrigin === undefined) return
    response.headers.set('access-control-allow-origin', allowOrigin)
    if (cors.credentials) response.headers.set('access-control-allow-credentials', 'true')
    if (allowOrigin !== '*') appendVary(response.headers, 'Origin')
}
