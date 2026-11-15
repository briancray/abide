// SECTION 24 — TRACING, in the W3C trace-context format: `traceparent` in, `traceparent` out, and
// `traceresponse` on the answer (21.2). A span is a log line (24.3), so there is no second feed to
// subscribe to — `log.records` carries both.
//
// THE CURRENT SPAN IS ITS OWN STORAGE rather than a field on the request scope: a span nests inside
// a request, and `trace.headers` read inside a `trace.span` body has to name that span as the parent
// (24.5) while a sibling running concurrently names its own.

import { AsyncLocalStorage } from 'node:async_hooks' // bun implements AsyncLocalStorage and has no context-carrying api of its own

import { exportSpan, writeSpan } from '#shared/log.ts'
import { isReactive } from '#shared/reactive/isReactive.ts'
import { isThenable } from '#shared/reactive/isThenable.ts'

import { randomToken } from './randomToken.ts'
import {
    currentRequestScope,
    type RequestScope,
    timed,
} from './requestScope.ts'

const SPAN = new AsyncLocalStorage<string>()

// 24.7 — RFC 9110's `token`, which is all a `server-timing` metric name may be.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

/**
 * A random nonzero hex id of `bytes` bytes.
 *
 * A ZERO id is invalid in the format, so the vanishingly unlikely one is minted again.
 */
function hex(bytes: number): string {
    for (;;) {
        const minted = randomToken(bytes, 'hex')
        if (!/^0+$/.test(minted)) return minted
    }
}

/**
 * The request's trace: its id, this process's span and the flags.
 *
 * 24.1 — BUILT ON FIRST ASK, and held on the scope for the rest of the request. The caller's trace
 * id is adopted where a valid `traceparent` came in; this process's own span is minted either way.
 */
function traceOf(scope: RequestScope): NonNullable<RequestScope['trace']> {
    if (scope.trace !== undefined) return scope.trace
    const given = TRACEPARENT.exec(
        scope.request?.headers.get('traceparent') ?? '',
    )
    scope.trace =
        given === null || /^0+$/.test(given[1] as string)
            ? { id: hex(16), span: hex(8), parent: '', flags: '00' }
            : {
                  id: given[1] as string,
                  span: hex(8),
                  parent: given[2] as string,
                  flags: given[3] as string,
              }
    return scope.trace
}

function currentSpan(scope: RequestScope): string {
    return SPAN.getStore() ?? traceOf(scope).span
}

/**
 * The current request's trace id, with `sampled`, `span` and `headers` on it.
 *
 * `''` OUTSIDE EVERY SCOPE: there is no operation for the work to belong to.
 */
export const trace = Object.assign(
    (): string => {
        const scope = currentRequestScope()
        return scope === undefined ? '' : traceOf(scope).id
    },
    {
        /**
         * Whether the trace is sampled.
         *
         * 24.2 — the caller's flag, verbatim; a trace this process started samples nothing.
         */
        sampled(): boolean {
            const scope = currentRequestScope()
            return (
                scope !== undefined &&
                (Number.parseInt(traceOf(scope).flags, 16) & 1) === 1
            )
        },
        /**
         * Runs `body` as a span, logging it when it settles; returns what `body` returns.
         *
         * 24.3, 24.4, 24.8 — ONE LINE PER SPAN, written when the body settles: `time` is when it started,
         * and the duration is `performance.now`'s, which a clock change cannot move. 24.6 — and
         * one `server-timing` entry where asked for, which only a span closed before the head
         * went out reaches.
         */
        span<T>(
            name: string,
            body: () => T,
            options?: { timing?: boolean },
        ): T {
            const timing = options?.timing === true
            if (timing && !TOKEN.test(name))
                throw new Error(
                    `abide: trace.span("${name}", …, { timing: true }) names a server-timing metric, which must be an HTTP token — no spaces, quotes or separators. RULEBOOK 24.7.`,
                )
            const scope = currentRequestScope()
            if (scope === undefined) return body()
            // 24.9 — its own id, and the span it opened under.
            const id = hex(8)
            const parent = currentSpan(scope)
            const startedAt = new Date().toISOString()
            const started = performance.now()
            const close = (status: 'ok' | 'error'): void => {
                const duration = performance.now() - started
                writeSpan(startedAt, `${name} ${duration.toFixed(3)}ms`, {
                    id,
                    parent,
                    name,
                    kind: 'internal',
                    duration,
                    status,
                    attributes: {},
                })
                if (timing) timed(scope.timing, name, duration)
            }
            const succeeded = (): void => close('ok')
            const failed = (): void => close('error')
            let result: T
            try {
                result = SPAN.run(id, body)
            } catch (thrown) {
                failed()
                throw thrown
            }
            if (result instanceof Promise)
                return result.then(
                    (value) => {
                        succeeded()
                        return value
                    },
                    (thrown: unknown) => {
                        failed()
                        throw thrown
                    },
                ) as T
            // 24.8 — ANY OTHER THENABLE IS WATCHED, NOT WRAPPED, so the caller keeps what it was
            // handed. A `Reactive` is a value here (1.6) and closes the span now.
            if (isThenable(result) && !isReactive(result))
                result.then(succeeded, failed)
            else succeeded()
            return result
        },
        /**
         * The `traceparent` header naming the current span, for an outgoing call.
         *
         * 24.5.
         */
        headers(): Record<string, string> {
            const scope = currentRequestScope()
            if (scope === undefined) return {}
            const current = traceOf(scope)
            return {
                traceparent: `00-${current.id}-${currentSpan(scope)}-${current.flags}`,
            }
        },
    },
)

/**
 * Writes the request's own span, answered at `status` after `duration` milliseconds, under `namespace`
 * as a `debug` line — or hands it to the exporter alone where it is not `written` — its id the one
 * `traceresponse` names, and its parent the caller's (24.10).
 */
export function writeRequestSpan(
    request: Request,
    status: number,
    startedAt: string,
    duration: number,
    namespace: string,
    written: boolean,
): void {
    const scope = currentRequestScope()
    if (scope === undefined) return
    const current = traceOf(scope)
    const { route } = scope
    const path = new URL(request.url).pathname
    // A route, not the address: the name of every request to `/contacts/[id]` is the same.
    const name =
        route === undefined ? request.method : `${request.method} ${route}`
    const attributes: Record<string, string | number> = {
        'http.request.method': request.method,
        'url.path': path,
        'http.response.status_code': status,
    }
    if (route !== undefined) attributes['http.route'] = route
    // 36.19 — exported alone where `abide:request` is closed, so an export prints nothing of its own.
    ;(written ? writeSpan : exportSpan)(
        startedAt,
        `${request.method} ${path} ${status} ${duration.toFixed(1)}ms`,
        {
            id: current.span,
            parent: current.parent,
            name,
            kind: 'server',
            duration,
            status: status >= 500 ? 'error' : 'ok',
            attributes,
        },
        namespace,
        'debug',
    )
}

/**
 * The answer's `traceresponse` value, naming this process's own span for the request.
 *
 * 21.2.
 */
export function traceResponse(): string | undefined {
    const scope = currentRequestScope()
    if (scope === undefined) return undefined
    const current = traceOf(scope)
    return `00-${current.id}-${current.span}-${current.flags}`
}
