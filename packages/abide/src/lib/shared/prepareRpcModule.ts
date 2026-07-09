import type { ExportCallSite } from './findExportCallSite.ts'
import { isReadOnlyMethod } from './isReadOnlyMethod.ts'
import { prepareRemoteExport } from './prepareRemoteExport.ts'
import { skipNonCode } from './skipNonCode.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

const RPC_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const RPC_SET = new Set<string>(RPC_NAMES)

const SINGLE_EXPORT_ERROR =
    '[abide] $rpc module contains more than one `<METHOD>(...)` export — each file must declare exactly one remote function'

export type PreparedRpcModule = {
    method: HttpMethod
    /* `outbox: true` in the opts — the client proxy is emitted durable. */
    durable: boolean
    /* The handler calls jsonl()/sse() — the client proxy is emitted streaming (bare call
       returns the NamedAsyncIterable). Congruent with the RemoteCallable conditional by construction. */
    streaming: boolean
    exportName: string
    rewriteForServer: (url: string) => string
    rewriteForClient: (url: string) => string
}

/* The `outbox` opts key plus its value's leading token (up to the next comma / whitespace /
   closing brace). `outbox` is a BUILD-TIME flag: the client bundle is rewritten durable or
   not from this scan, before any handler runs — so the value must be a literal the scan can
   read, not a computed expression. */
const OUTBOX_OPT = /\boutbox\s*:\s*([^,\s}]+)/

/*
Scans an `$rpc/**` module once and returns its declared method + export
name plus a closure that, given the route URL, emits the server-side
rewrite (`__abideDefineRpc__("METHOD", "<url>", … )` spliced into the
original source). The single scan replaces the prior separate
extract + rewrite passes, so the resolver plugin only walks each source
character-by-character once.

A regex pass would be tidier but it can't tell a `GET` mention inside a
docstring or template literal from the real call, and it can't follow
nested generics like `GET<Map<K, V>>(`.

The two build-time `outbox` invariants live here, not at runtime, because the
client bundle's durability is decided here — making this the single source of
truth (the server-side defineRpc guard stays as a cheap backstop):
  - `outbox` must be a literal `true`/`false`; a computed value can't be read at
    bundle time, so it's rejected loudly instead of silently shipping a
    non-durable client proxy.
  - `outbox: true` is mutating-only — a read RPC (GET/HEAD) has nothing to
    durably deliver.
*/
export function prepareRpcModule(
    source: string,
    importName: string,
    streamingOverride?: boolean,
    durableOverride?: boolean,
): PreparedRpcModule | undefined {
    /*
    The "no barrels" surface places each method at its own path
    (`abide/server/GET`, `abide/server/POST`, …), so the strip subpaths are
    every method under each import name — the user's method import must not
    linger and side-effect-load the stub module into the server bundle.
    */
    const prepared = prepareRemoteExport(
        source,
        importName,
        (name) => RPC_NAMES.map((method) => `${name}/server/${method}`),
        (ident) => RPC_SET.has(ident),
        SINGLE_EXPORT_ERROR,
    )
    if (!prepared) {
        return undefined
    }
    const { stripped, site } = prepared
    const method = site.ident as HttpMethod
    /* Durability is decided by the warm server program's outbox-property type query when it
       resolved a verdict (ADR-0025 D2 — it reads an imported-const `outbox` the regex can't);
       undefined (no warm program / a computed value) falls open to the char-scan `detectDurable`,
       which rejects a non-literal loudly. The mutating-method invariant holds on either path. */
    const durable = resolveDurable(stripped, site, method, durableOverride)
    /* Streaming is decided by the warm server program's return-type query when it resolved a
       verdict (ADR-0025 D2 — it sees the wrapper-indirection case the scan misses); undefined
       (no warm program / unresolvable node) falls open to the char-scan, byte-identical to before. */
    const streaming = streamingOverride ?? detectStreaming(stripped, site.parenStart, site.parenEnd)
    /* The call's top-level args (handler + optional opts), dropping a trailing-comma empty
       part. The handler is elided on the client; `opts` (schemas/cache/stream) rides through as
       a LIVE expression in the kept module (ADR-0022 D2) — evaluated in its real scope, so it can
       reference imported constants, composed values, and separate modules. */
    const argParts = splitTopLevelArgs(stripped, site.parenStart, site.parenEnd)
    return {
        method,
        durable,
        streaming,
        exportName: site.exportName,
        rewriteForServer(url: string): string {
            const binding = `__abideDefineRpc__(${JSON.stringify(method)}, ${JSON.stringify(url)}, `
            const head = stripped.slice(0, site.callStart) + binding
            if (!streaming) {
                return head + stripped.slice(site.parenStart + 1)
            }
            /* Inject the build-time streaming flag into the handler's opts, preserving any author
               opts by spread. Reuse the top-level arg split (handler + optional opts) so a trailing
               comma or absent opts can't produce `...()`. `head` ends after the METHOD( paren; keep
               everything from `)` onward. */
            const [handler, opts] = argParts
            const injected = opts ? `{ streaming: true, ...(${opts}) }` : '{ streaming: true }'
            return `${head}${handler}, ${injected}${stripped.slice(site.parenEnd)}`
        },
        /*
        Client rewrite, symmetric with rewriteForServer: keep the real module, swap the
        METHOD( call for a remoteProxy( call, and ELIDE the handler argument. The handler and
        the imports only it used become dead code the bundler tree-shakes out of the client
        bundle (proven safe by the D3 reachability guard). `method`/`url` are the build-time
        scalars; `opts` is left VERBATIM as a live expression, so endpoint policy (cache/stream)
        can reference imports; `streaming` is the only genuinely build-injected flag — it's
        derived from the elided handler body (returns jsonl()/sse()), so it can't ride `opts`.
        remoteProxy reads only outbox/streaming/cache/stream off the opts and ignores the rest.
        */
        rewriteForClient(url: string): string {
            const callHead = `${stripped.slice(0, site.callStart)}__abideRemoteProxy__(${JSON.stringify(method)}, ${JSON.stringify(url)}`
            const opts = argParts[1]
            let argsText: string
            if (opts === undefined) {
                argsText = streaming ? ', { streaming: true }' : ''
            } else {
                argsText = streaming ? `, { streaming: true, ...(${opts}) }` : `, ${opts}`
            }
            /* Keep everything from the call's closing paren onward (same slicing discipline as
               rewriteForServer) so any trailing content after the call survives. */
            return `${callHead}${argsText}${stripped.slice(site.parenEnd)}`
        },
    }
}

/* The rpc's durability, program-primary with the char-scan as fail-open fallback. A resolved
   `durableOverride` (the warm program read the `outbox` property's boolean-literal type) skips
   the scan but still enforces the mutating-method invariant, so the WITH-program path is byte-
   equivalent to the scan for every case the scan handles and additionally reads a statically-
   known non-inline `outbox`. undefined defers wholly to `detectDurable`. */
function resolveDurable(
    source: string,
    site: ExportCallSite,
    method: HttpMethod,
    durableOverride: boolean | undefined,
): boolean {
    if (durableOverride === undefined) {
        return detectDurable(source, site.parenStart, site.parenEnd, method)
    }
    if (durableOverride && isReadOnlyMethod(method)) {
        throw new Error(
            `[abide] outbox: true is only valid on mutating RPCs (POST/PUT/PATCH/DELETE), not ${method}`,
        )
    }
    return durableOverride
}

/* Reads the `outbox` flag off the call's opts object (the trailing argument), enforcing the
   two build-time invariants. The fail-open fallback for `resolveDurable` when no warm program
   resolved the outbox literal type (ADR-0025 D3). Scoping to the opts object keeps the scan off
   the handler body, so a handler that mentions `outbox:` doesn't misfire. */
function detectDurable(
    source: string,
    parenStart: number,
    parenEnd: number,
    method: HttpMethod,
): boolean {
    const opts = lastArgText(source, parenStart, parenEnd)
    const match = opts === undefined ? null : OUTBOX_OPT.exec(opts)
    if (match === null) {
        return false
    }
    const value = match[1]
    if (value !== 'true' && value !== 'false') {
        throw new Error(
            `[abide] \`outbox\` must be a literal \`true\` or \`false\` (got \`${value}\`) — it's a build-time flag the client bundle reads, so it can't be a computed expression`,
        )
    }
    const durable = value === 'true'
    if (durable && isReadOnlyMethod(method)) {
        throw new Error(
            `[abide] outbox: true is only valid on mutating RPCs (POST/PUT/PATCH/DELETE), not ${method}`,
        )
    }
    return durable
}

const STREAM_HELPERS = new Set(['jsonl', 'sse'])
const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/

/* True when the handler returns a streaming body — it calls abide's jsonl()/sse(), the only
   constructors of a `TypedResponse<AsyncIterable<Frame>>`. Congruent by construction with the
   RemoteCallable conditional (Return is an AsyncIterable iff the handler calls jsonl/sse). Scans
   the whole call-arg region depth-blind (the opts never mention jsonl/sse), skipping
   strings/comments/regex via skipNonCode so a mention in a literal can't misfire. Same
   literal-only limit as `outbox`: an indirection through a wrapper function isn't seen. */
function detectStreaming(source: string, parenStart: number, parenEnd: number): boolean {
    let i = parenStart + 1
    while (i < parenEnd) {
        const skipped = skipNonCode(source, i)
        if (skipped !== undefined) {
            i = skipped
            continue
        }
        if (IDENT_START.test(source[i] ?? '') && !IDENT_PART.test(source[i - 1] ?? '')) {
            let j = i + 1
            while (j < parenEnd && IDENT_PART.test(source[j] ?? '')) {
                j += 1
            }
            if (STREAM_HELPERS.has(source.slice(i, j))) {
                let k = j
                while (k < parenEnd && /\s/.test(source[k] ?? '')) {
                    k += 1
                }
                /* `jsonl(` a call, `jsonl<` a generic call — either is the streaming constructor. */
                if (source[k] === '(' || source[k] === '<') {
                    return true
                }
            }
            i = j
            continue
        }
        i += 1
    }
    return false
}

/* The call's top-level arguments, trimmed, with empty parts (a trailing comma) dropped —
   `[handler]` or `[handler, opts]`. Depth-aware and skips strings/comments/regex so commas
   inside the handler body or opts don't miscount. */
function splitTopLevelArgs(source: string, parenStart: number, parenEnd: number): string[] {
    const parts: string[] = []
    let depth = 0
    let start = parenStart + 1
    let i = parenStart + 1
    while (i < parenEnd) {
        const skipped = skipNonCode(source, i)
        if (skipped !== undefined) {
            i = skipped
            continue
        }
        const c = source[i]
        if (c === '(' || c === '{' || c === '[') {
            depth += 1
        } else if (c === ')' || c === '}' || c === ']') {
            depth -= 1
        } else if (c === ',' && depth === 0) {
            parts.push(source.slice(start, i).trim())
            start = i + 1
        }
        i += 1
    }
    parts.push(source.slice(start, parenEnd).trim())
    return parts.filter((part) => part.length > 0)
}

/*
The text of the call's final argument — the opts object for a `METHOD(handler, opts)` call.
Walks the arg list depth-aware, skipping strings / templates / comments / regex (skipNonCode)
so their commas and braces don't miscount, and returns the slice after the last top-level
comma. undefined when the call has a single argument (a bare handler, no opts).
*/
function lastArgText(source: string, parenStart: number, parenEnd: number): string | undefined {
    let depth = 0
    let lastComma = -1
    let i = parenStart + 1
    while (i < parenEnd) {
        const skipped = skipNonCode(source, i)
        if (skipped !== undefined) {
            i = skipped
            continue
        }
        const c = source[i]
        if (c === '(' || c === '{' || c === '[') {
            depth++
        } else if (c === ')' || c === '}' || c === ']') {
            depth--
        } else if (c === ',' && depth === 0) {
            lastComma = i
        }
        i++
    }
    return lastComma === -1 ? undefined : source.slice(lastComma + 1, parenEnd)
}
