import { findExportCallSite } from './findExportCallSite.ts'
import { importNamesToStrip } from './importNamesToStrip.ts'
import { isReadOnlyMethod } from './isReadOnlyMethod.ts'
import { skipNonCode } from './skipNonCode.ts'
import { stripImport } from './stripImport.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

const RPC_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const RPC_SET = new Set<string>(RPC_NAMES)

const SINGLE_EXPORT_ERROR =
    '[abide] $rpc module contains more than one `<METHOD>(...)` export — each file must declare exactly one remote function'

export type PreparedRpcModule = {
    method: HttpMethod
    /* `outbox: true` in the opts — the client proxy is emitted durable. */
    durable: boolean
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
    (`abide/server/GET`, `abide/server/POST`, …) — strip every one so
    the user's method import doesn't linger and side-effect-load the
    stub module into the server bundle. The user may import under the
    project's chosen name or the canonical package name, so strip both.
    */
    const stripped = importNamesToStrip(importName).reduce(
        (current, name) =>
            RPC_NAMES.reduce(
                (acc, method) => stripImport(acc, `${name}/server/${method}`),
                current,
            ),
        source,
    )
    const site = findExportCallSite(stripped, (ident) => RPC_SET.has(ident), SINGLE_EXPORT_ERROR)
    if (!site) {
        return undefined
    }
    const method = site.ident as HttpMethod
    const durable = detectDurable(stripped, site.parenStart, site.parenEnd, method)
    return {
        method,
        durable,
        exportName: site.exportName,
        rewriteForServer(url: string): string {
            const binding = `__abideDefineRpc__(${JSON.stringify(method)}, ${JSON.stringify(url)}, `
            return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenStart + 1)
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
