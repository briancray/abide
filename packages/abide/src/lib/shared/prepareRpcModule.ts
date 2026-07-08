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
    /* The verbatim source TEXT of the endpoint's `cache` / `stream` policy (ADR-0020) — the
       value expression of the `cache:` / `stream:` property in the opts object literal, or
       undefined when the property (or the whole opts arg) is absent. The resolver plugin splices
       these into the client proxy stub so `remote.cache` / `remote.stream` govern client cache
       behaviour (staleness/SWR, the refetch clock, tags), not just the server-side read.

       BUILD-TIME, SELF-CONTAINED constraint (mirrors the `outbox`-must-be-a-literal rule): the
       text is lifted into a fresh client stub that has NONE of the source module's imports, so the
       policy expression must reference only literals and self-contained arrow functions
       (`tags: (args) => ['rates:' + args.base]`) — never a server-module-scope identifier or
       import. A reference that resolves in the source module would be undefined in the stub. */
    cachePolicyText?: string
    streamPolicyText?: string
    exportName: string
    rewriteForServer: (url: string) => string
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
    const durable = detectDurable(stripped, site.parenStart, site.parenEnd, method)
    const streaming = detectStreaming(stripped, site.parenStart, site.parenEnd)
    /* The call's top-level args (handler + optional opts), dropping a trailing-comma empty
       part. Computed once from the ORIGINAL opts — before any streaming injection — so the
       policy text lifted for the client stub is the author's, untouched. */
    const argParts = splitTopLevelArgs(stripped, site.parenStart, site.parenEnd)
    const optsText = argParts[1]
    const cachePolicyText =
        optsText === undefined ? undefined : extractObjectProperty(optsText, 'cache')
    const streamPolicyText =
        optsText === undefined ? undefined : extractObjectProperty(optsText, 'stream')
    return {
        method,
        durable,
        streaming,
        cachePolicyText,
        streamPolicyText,
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
    }
}

/* Reads the `outbox` flag off the call's opts object (the trailing argument), enforcing the
   two build-time invariants. Scoping to the opts object keeps the scan off the handler body,
   so a handler that mentions `outbox:` doesn't misfire. */
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

/*
The verbatim source text of a top-level property's value in an object literal —
`extractObjectProperty('{ cache: { ttl: 5 }, timeout: 3 }', 'cache')` → `'{ ttl: 5 }'`.
Walks depth-aware from the literal's opening brace, skipping strings / templates / comments
/ regex (skipNonCode) so their braces, commas, and colons can't miscount. A key matches only
at the object's own top level (immediately after `{` or a top-level `,`) and only when
followed by `:`, so a nested occurrence (`schemas: { cache: … }`) or a shorthand (`{ cache }`)
never matches. Returns the value expression spanning balanced braces/parens/brackets up to the
next top-level comma or the closing brace; undefined when the key is absent.
*/
function extractObjectProperty(objectLiteralText: string, key: string): string | undefined {
    const open = objectLiteralText.indexOf('{')
    if (open === -1) {
        return undefined
    }
    let depth = 0
    /* The last non-whitespace CODE character seen (strings/comments skipped) — a key sits at
       the top level only when it follows the opening `{` or a top-level `,`. */
    let prevCode = ''
    let i = open
    while (i < objectLiteralText.length) {
        const skipped = skipNonCode(objectLiteralText, i)
        if (skipped !== undefined) {
            prevCode = objectLiteralText[skipped - 1] ?? prevCode
            i = skipped
            continue
        }
        const c = objectLiteralText[i] ?? ''
        if (/\s/.test(c)) {
            i += 1
            continue
        }
        if (c === '{' || c === '[' || c === '(') {
            depth += 1
            prevCode = c
            i += 1
            continue
        }
        if (c === '}' || c === ']' || c === ')') {
            depth -= 1
            prevCode = c
            i += 1
            if (depth === 0) {
                return undefined
            }
            continue
        }
        /* A candidate key: an identifier at the object's top level, right after `{` or `,`. */
        if (depth === 1 && (prevCode === '{' || prevCode === ',') && IDENT_START.test(c)) {
            let j = i + 1
            while (j < objectLiteralText.length && IDENT_PART.test(objectLiteralText[j] ?? '')) {
                j += 1
            }
            const ident = objectLiteralText.slice(i, j)
            let colon = j
            while (colon < objectLiteralText.length && /\s/.test(objectLiteralText[colon] ?? '')) {
                colon += 1
            }
            if (objectLiteralText[colon] === ':') {
                if (ident === key) {
                    return readPropertyValue(objectLiteralText, colon + 1)
                }
                /* A different key — resume just past its colon; its value walks normally below. */
                prevCode = ':'
                i = colon + 1
                continue
            }
            /* Shorthand or spread — not a `key:` property; skip the identifier. */
            prevCode = objectLiteralText[j - 1] ?? prevCode
            i = j
            continue
        }
        prevCode = c
        i += 1
    }
    return undefined
}

/*
Reads a property's value expression starting just after its `:` — skips leading whitespace, then
consumes chars depth-aware (strings/comments via skipNonCode) until the top-level `,` that ends
the property or the `}` that closes the object. Returns the trimmed value text.
*/
function readPropertyValue(source: string, afterColon: number): string {
    let i = afterColon
    while (i < source.length && /\s/.test(source[i] ?? '')) {
        i += 1
    }
    const valueStart = i
    let depth = 0
    while (i < source.length) {
        const skipped = skipNonCode(source, i)
        if (skipped !== undefined) {
            i = skipped
            continue
        }
        const c = source[i]
        if (c === '{' || c === '[' || c === '(') {
            depth += 1
        } else if (c === '}' || c === ']' || c === ')') {
            if (depth === 0) {
                break
            }
            depth -= 1
        } else if (c === ',' && depth === 0) {
            break
        }
        i += 1
    }
    return source.slice(valueStart, i).trim()
}
