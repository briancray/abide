import { HTTP_METHODS } from './HTTP_METHODS.ts'
import { prepareRemoteExport } from './prepareRemoteExport.ts'
import { DEFINE_RPC_GLOBAL, REMOTE_PROXY_GLOBAL } from './RPC_SHIM_GLOBALS.ts'
import { skipNonCode } from './skipNonCode.ts'
import type { HttpMethod } from './types/HttpMethod.ts'
import type { RpcBuildStamps } from './types/RpcBuildStamps.ts'

const RPC_NAMES = HTTP_METHODS
const RPC_SET = new Set<string>(RPC_NAMES)

const SINGLE_EXPORT_ERROR =
    '[abide] $rpc module contains more than one `<METHOD>(...)` export — each file must declare exactly one remote function'

export type PreparedRpcModule = {
    method: HttpMethod
    /* The handler calls jsonl()/sse() — the client proxy is emitted streaming (bare call
       returns the NamedAsyncIterable). Congruent with the RemoteCallable conditional by construction. */
    streaming: boolean
    exportName: string
    rewriteForServer: (url: string) => string
    rewriteForClient: (url: string) => string
}

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
*/
export function prepareRpcModule(
    source: string,
    importName: string,
    stamps: RpcBuildStamps = {},
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
    /* Streaming is decided by the warm server program's return-type query when it resolved a
       verdict (ADR-0025 D2 — it sees the wrapper-indirection case the scan misses); undefined
       (no warm program / unresolvable node) falls open to the char-scan, byte-identical to before. */
    const streaming = stamps.streaming ?? detectStreaming(stripped, site.parenStart, site.parenEnd)
    /* The call's top-level args (handler + optional opts), dropping a trailing-comma empty
       part. The handler is elided on the client; `opts` (schemas/cache/stream) rides through as
       a LIVE expression in the kept module (ADR-0022 D2) — evaluated in its real scope, so it can
       reference imported constants, composed values, and separate modules. */
    const argParts = splitTopLevelArgs(stripped, site.parenStart, site.parenEnd)
    return {
        method,
        streaming,
        exportName: site.exportName,
        rewriteForServer(url: string): string {
            const binding = `${DEFINE_RPC_GLOBAL}(${JSON.stringify(method)}, ${JSON.stringify(url)}, `
            const head = stripped.slice(0, site.callStart) + binding
            /* Build-injected server opts: `streaming` (from the handler body / return type), the
               `coerce` plan (numeric/boolean query fields → typed, ADR-0028), `inputJsonSchema` (the
               handler's input args projected to JSON Schema, ADR-0030 input side), `outputJsonSchema`
               (the handler return type projected to JSON Schema, ADR-0030 D2), and `errorJsonSchemas`
               (the handler's typed-error branches as a status-keyed schema map, ADR-0030). All are
               stamped into a fresh opts object that spreads the author's opts, so policy stays live.
               With none present the original args pass through untouched. */
            const injected: string[] = []
            if (streaming) {
                injected.push('streaming: true')
            }
            if (stamps.coercion !== undefined) {
                injected.push(`coerce: ${JSON.stringify(stamps.coercion)}`)
            }
            if (stamps.inputSchema !== undefined) {
                injected.push(`inputJsonSchema: ${JSON.stringify(stamps.inputSchema)}`)
            }
            if (stamps.outputSchema !== undefined) {
                injected.push(`outputJsonSchema: ${JSON.stringify(stamps.outputSchema)}`)
            }
            if (stamps.errorSchemas !== undefined) {
                injected.push(`errorJsonSchemas: ${JSON.stringify(stamps.errorSchemas)}`)
            }
            if (injected.length === 0) {
                return head + stripped.slice(site.parenStart + 1)
            }
            /* Reuse the top-level arg split (handler + optional opts) so a trailing comma or absent
               opts can't produce `...()`. `head` ends after the METHOD( paren; keep everything from
               `)` onward. */
            const [handler, opts] = argParts
            const optsObject = opts
                ? `{ ${injected.join(', ')}, ...(${opts}) }`
                : `{ ${injected.join(', ')} }`
            return `${head}${handler}, ${optsObject}${stripped.slice(site.parenEnd)}`
        },
        /*
        Client rewrite, symmetric with rewriteForServer: keep the real module, swap the
        METHOD( call for a remoteProxy( call, and ELIDE the handler argument. The handler and
        the imports only it used become dead code the bundler tree-shakes out of the client
        bundle (proven safe by the D3 reachability guard). `method`/`url` are the build-time
        scalars; `opts` is left VERBATIM as a live expression, so endpoint policy (cache/stream)
        can reference imports; `streaming` is the only genuinely build-injected flag — it's
        derived from the elided handler body (returns jsonl()/sse()), so it can't ride `opts`.
        remoteProxy reads only streaming/cache/stream off the opts and ignores the rest.
        */
        rewriteForClient(url: string): string {
            const opts = argParts[1]
            /* Build-injected CLIENT opts: `streaming` (build-derived from the elided handler body)
               and the `outputWirePlan` (the handler's structured success fields → the client revives
               a `Set`/`Map`/`bigint`/`Date` off the decoded response, ADR-0029). Both are stamped
               into a fresh opts object that spreads the author's live `opts`, so endpoint policy
               (cache/stream/schemas) still rides through verbatim. */
            const injected: string[] = []
            if (streaming) {
                injected.push('streaming: true')
            }
            if (stamps.outputWirePlan !== undefined) {
                injected.push(`outputWirePlan: ${JSON.stringify(stamps.outputWirePlan)}`)
            }
            let argsText: string
            if (injected.length === 0) {
                argsText = opts === undefined ? '' : `, ${opts}`
            } else {
                const injectedText = injected.join(', ')
                argsText =
                    opts === undefined
                        ? `, { ${injectedText} }`
                        : `, { ${injectedText}, ...(${opts}) }`
            }
            const remoteCall = `${REMOTE_PROXY_GLOBAL}(${JSON.stringify(method)}, ${JSON.stringify(url)}${argsText})`
            /*
            Minimal emit (ADR-0022 addendum): the warm program resolved which top-level statements
            the live `opts` actually reaches, so emit ONLY those plus the `remoteProxy` export. The
            handler and every declaration/import only it used are never emitted — nothing server-side
            is loaded, tree-shaken, or flagged, matching "the client is only ever a fetch". An empty
            plan (no opts, or opts references nothing top-level) emits the bare call alone.
            */
            const clientKeep = stamps.clientKeep
            if (clientKeep !== undefined) {
                const exportLine = `export const ${site.exportName} = ${remoteCall}`
                return clientKeep.length > 0
                    ? `${clientKeep.join('\n')}\n${exportLine}\n`
                    : `${exportLine}\n`
            }
            /*
            Fallback (no warm program): keep the real module, swap the METHOD( call for the
            remoteProxy( call, and elide the handler argument — leaning on the bundler's DCE to drop
            the dead server imports. `stripped.slice(0, site.callStart)` keeps the imports + the
            `export const <name> = ` head; `stripped.slice(site.parenEnd)` keeps any trailing content.
            */
            const callHead = `${stripped.slice(0, site.callStart)}${REMOTE_PROXY_GLOBAL}(${JSON.stringify(method)}, ${JSON.stringify(url)}`
            return `${callHead}${argsText}${stripped.slice(site.parenEnd)}`
        },
    }
}

const STREAM_HELPERS = new Set(['jsonl', 'sse'])
const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/

/* True when the handler returns a streaming body — it calls abide's jsonl()/sse(), the only
   constructors of a `TypedResponse<AsyncIterable<Frame>>`. Congruent by construction with the
   RemoteCallable conditional (Return is an AsyncIterable iff the handler calls jsonl/sse). Scans
   the whole call-arg region depth-blind (the opts never mention jsonl/sse), skipping
   strings/comments/regex via skipNonCode so a mention in a literal can't misfire. A
   literal-only limit: an indirection through a wrapper function isn't seen (the warm server
   program's return-type query covers that case). */
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
