// SECTION 24 — TRACING, in the W3C trace-context format: `traceparent` in, `traceparent` out, and
// `traceresponse` on the answer (21.2). A span is a log line (24.3), so there is no second feed to
// subscribe to — `log.records` carries both.
//
// THE CURRENT SPAN IS ITS OWN STORAGE rather than a field on the request scope: a span nests inside
// a request, and `trace.headers` read inside a `trace.span` body has to name that span as the parent
// (24.5) while a sibling running concurrently names its own.

import { AsyncLocalStorage } from 'node:async_hooks' // bun implements AsyncLocalStorage and has no context-carrying api of its own
import { TRACE, writeSpan } from '#shared/log.ts'
import { randomToken } from './randomToken.ts'
import { currentRequestScope, type RequestScope } from './requestScope.ts'

const SPAN = new AsyncLocalStorage<string>()

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

// A ZERO id is invalid in the format, so the vanishingly unlikely one is minted again.
function hex(bytes: number): string {
    for (;;) {
        const minted = randomToken(bytes, 'hex')
        if (!/^0+$/.test(minted)) return minted
    }
}

// 24.1 — BUILT ON FIRST ASK, and held on the scope for the rest of the request. The caller's trace
// id is adopted where a valid `traceparent` came in; this process's own span is minted either way.
function traceOf(scope: RequestScope): NonNullable<RequestScope['trace']> {
    if (scope.trace !== undefined) return scope.trace
    const given = TRACEPARENT.exec(
        scope.request?.headers.get('traceparent') ?? '',
    )
    scope.trace =
        given === null || /^0+$/.test(given[1] as string)
            ? { id: hex(16), span: hex(8), flags: '00' }
            : {
                  id: given[1] as string,
                  span: hex(8),
                  flags: given[3] as string,
              }
    return scope.trace
}

function currentSpan(scope: RequestScope): string {
    return SPAN.getStore() ?? traceOf(scope).span
}

// `''` OUTSIDE EVERY SCOPE: there is no operation for the work to belong to.
export const trace = Object.assign(
    (): string => {
        const scope = currentRequestScope()
        return scope === undefined ? '' : traceOf(scope).id
    },
    {
        // 24.2 — the caller's flag, verbatim; a trace this process started samples nothing.
        sampled(): boolean {
            const scope = currentRequestScope()
            return (
                scope !== undefined &&
                (Number.parseInt(traceOf(scope).flags, 16) & 1) === 1
            )
        },
        // 24.3, 24.4 — ONE LINE PER SPAN, written when the body settles: `time` is when it started,
        // and the duration is `performance.now`'s, which a clock change cannot move.
        span<T>(name: string, body: () => T): T {
            const scope = currentRequestScope()
            if (scope === undefined) return body()
            traceOf(scope)
            const startedAt = new Date().toISOString()
            const started = performance.now()
            const close = (): void => {
                writeSpan(
                    startedAt,
                    `${name} ${(performance.now() - started).toFixed(3)}ms`,
                )
            }
            let result: T
            try {
                result = SPAN.run(hex(8), body)
            } catch (thrown) {
                close()
                throw thrown
            }
            if (result instanceof Promise) return result.finally(close) as T
            close()
            return result
        },
        // 24.5.
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

// 21.2 — what the answer carries, naming this process's own span for the request.
export function traceResponse(): string | undefined {
    const scope = currentRequestScope()
    if (scope === undefined) return undefined
    const current = traceOf(scope)
    return `00-${current.id}-${current.span}-${current.flags}`
}

// Every log line written inside a scope carries its trace id.
TRACE.current = trace
