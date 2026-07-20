// `.abide` SERVER MODULE EMITTER (Stage 1, PR3) — BUILD/SSR-SIDE ONLY.
//
// Turns a `TemplatePlan` + `ScopeAnalysis` into an ES-module string exporting `async function
// render($scope)` that builds the SSR HTML string. Reads from the SAME plan the client emitter uses,
// so comment anchors match. Uses `serverRuntime` ($rt) for escaping / attribute serialization and
// lexical `<script>` bindings from `emitSetup`. Event attributes are omitted (as `renderServer` does).

import type { ScopeAnalysis, ScriptInfo } from './analyzeScope.ts'
import { extractBindingNames, reconstructImport } from './analyzeScope.ts'
import { emitInstanceSetup, emitModuleEnsure } from './emitSetup.ts'
import type { AttrPlan, ServerChunk, TemplatePlan } from './templatePlan.ts'

// RPC route imports follow the `src/server/rpc/<name>.ts` file convention, so their specifier carries a
// `server/rpc/` segment. A `{#for await}` head that resolves to one is ATTACHABLE (replayable-streams.md
// §5) — its transcript can be handed off to the client instead of re-run. Any other head (a local async
// generator, a `fetch().body`, a state binding) is not.
const RPC_SPECIFIER = /(^|\/)server\/rpc\//

// The local names bound by RPC route imports across the module + instance scripts (default and named).
// By framework convention the import LOCAL equals the route/wire name (`$scope[local]` on both sides),
// so the local doubles as the `rpcName` recorded on the handoff.
function rpcImportLocals(analysis: ScopeAnalysis): Set<string> {
    const locals = new Set<string>()
    const collect = (script: ScriptInfo | null): void => {
        if (script === null) return
        for (const binding of script.imports) {
            if (!RPC_SPECIFIER.test(binding.specifier)) continue
            if (binding.defaultLocal !== null) locals.add(binding.defaultLocal)
            for (const entry of binding.named) locals.add(entry.local)
        }
    }
    collect(analysis.module)
    collect(analysis.instance)
    return locals
}

// Slice out the balanced argument list of a `head(...)` call starting at the `(` at `openIndex`. String
// and template-literal bodies are treated as opaque so a `)` inside them never miscounts depth. Returns
// the inner text (may be empty), or null when the parens are unbalanced.
function extractCallArgs(src: string, openIndex: number): string | null {
    let depth = 0
    let inString: string | null = null
    for (let i = openIndex; i < src.length; i++) {
        const ch = src[i]
        if (inString !== null) {
            if (ch === '\\') i++
            else if (ch === inString) inString = null
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') inString = ch
        else if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--
            if (depth === 0) return src.slice(openIndex + 1, i)
        }
    }
    return null
}

// If a `{#for await}` iterable is a call `rpcName(<args>)` whose head is an RPC import, return the wire
// name + the argument expression (empty string for a zero-arg call) so the emitter can tag the source
// attachable (§5). Any non-RPC head, non-call form, or unbalanced parens → null (client re-iterates).
function parseAttachSource(
    iterable: string,
    rpcLocals: Set<string>,
): { rpcName: string; args: string } | null {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(iterable)
    if (match === null) return null
    const head = match[1]
    if (head === undefined) return null
    if (!rpcLocals.has(head)) return null
    const args = extractCallArgs(iterable, match.index + match[0].length - 1)
    if (args === null) return null
    return { rpcName: head, args }
}

function componentRef(analysis: ScopeAnalysis, name: string): string {
    return analysis.declared.has(name) ? name : `$scope.${name}`
}

// Emit code that binds `pattern` from `valueExpr` onto the scope object `target`.
function bindPattern(target: string, pattern: string, valueExpr: string): string {
    const trimmed = pattern.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed))
        return `${target}[${JSON.stringify(trimmed)}] = ${valueExpr};`
    const names = extractBindingNames(trimmed)
    return `Object.assign(${target}, (() => { const ${trimmed} = ${valueExpr}; return { ${names.join(', ')} }; })());`
}

// A child scope expression carrying an optional single binding (block param / for item).
function childScopeCode(target: string, param: string | null, valueExpr: string): string {
    let out = `const ${target} = Object.create($scope);\n`
    if (param !== null && param.trim() !== '') out += `${bindPattern(target, param, valueExpr)}\n`
    return out
}

// An async arrow that renders a chunk list against a `$scope` param and returns a string.
function bodyExpr(analysis: ScopeAnalysis, chunks: ServerChunk[]): string {
    return `(async ($scope) => {\n  let $out = "";\n${genChunks(analysis, chunks)}  return $out;\n})`
}

function genElement(
    analysis: ScopeAnalysis,
    name: string,
    isVoid: boolean,
    attrs: AttrPlan[],
    children: ServerChunk[],
    scopeAttr: string | null,
): string {
    let out = '  {\n    const $a = $rt.attrBuilder();\n'
    for (const attr of attrs) {
        switch (attr.kind) {
            case 'static':
                out += `    $rt.applyStatic($a, ${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`
                break
            case 'expr':
                out += `    $rt.applyExpr($a, ${JSON.stringify(attr.name)}, await (${attr.expr}));\n`
                break
            case 'event':
                break // omitted server-side
            case 'class':
                out += `    $rt.applyClassDir($a, ${JSON.stringify(attr.name)}, await (${attr.expr}));\n`
                break
            case 'style':
                out += `    $rt.applyStyleDir($a, ${JSON.stringify(attr.name)}, await (${attr.expr}));\n`
                break
            case 'bind':
                out += `    $rt.applyBind($a, ${JSON.stringify(attr.name)}, await (${attr.expr}));\n`
                break
            case 'spread':
                out += `    $rt.applySpread($a, await (${attr.expr}));\n`
                break
        }
    }
    // #20: stamp the #13 scope attribute LAST (after the element's own attrs), matching the client
    // skeleton's trailing bare ` data-ab-<hash>`; a null value serializes as a bare attribute.
    if (scopeAttr !== null) out += `    $rt.applyStatic($a, ${JSON.stringify(scopeAttr)}, null);\n`
    out += `    $out += "<${name}" + $a.serialize() + ">";\n`
    if (!isVoid) {
        out += `    $out += await ${bodyExpr(analysis, children)}($scope);\n`
        out += `    $out += ${JSON.stringify(`</${name}>`)};\n`
    }
    out += '  }\n'
    return out
}

function genComponent(
    analysis: ScopeAnalysis,
    name: string,
    attrs: AttrPlan[],
    children: ServerChunk[],
    hasChildren: boolean,
): string {
    let out = '  {\n    const $props = {};\n'
    for (const attr of attrs) {
        switch (attr.kind) {
            case 'static':
                out += `    $props[${JSON.stringify(attr.name)}] = ${attr.value === null ? 'true' : JSON.stringify(attr.value)};\n`
                break
            case 'expr':
            case 'bind':
                out += `    $props[${JSON.stringify(attr.name)}] = await (${attr.expr});\n`
                break
            case 'spread':
                out += `    { const $s = await (${attr.expr}); if ($s !== null && typeof $s === "object") Object.assign($props, $s); }\n`
                break
            case 'event':
            case 'class':
            case 'style':
                break // ignored on components (M4b)
        }
    }
    out += `    const $c = ${componentRef(analysis, name)};\n`
    out += `    if (typeof $c !== "function") throw new Error(${JSON.stringify(`<${name}> is not a component in scope (expected a render function)`)});\n`
    if (hasChildren)
        out += `    const $children = async () => new $rt.Raw(await ${bodyExpr(analysis, children)}($scope));\n`
    else out += `    const $children = async () => new $rt.Raw("");\n`
    out += `    const $r = await $c($props, $children, $scope);\n`
    out += `    $out += $r instanceof $rt.Raw ? $r.value : String($r ?? "");\n`
    out += '  }\n'
    return out
}

// Block/component kinds are wrapped in the paired `<!--[-->…<!--]-->` anchors emitted by the client
// skeleton (templatePlan: `<!--[--><!--]-->` per block/component). Leaves carry a trailing `<!---->`
// inside their own case. Anchors match the client by construction — both sides read the SAME plan.
function genChunk(analysis: ScopeAnalysis, chunk: ServerChunk): string {
    const code = genChunkRaw(analysis, chunk)
    switch (chunk.kind) {
        case 'component':
        case 'if':
        case 'for':
        case 'awaitBlock':
        case 'switch':
        case 'try':
            return `  $out += "<!--[-->";\n${code}  $out += "<!--]-->";\n`
        default:
            return code
    }
}

function genChunkRaw(analysis: ScopeAnalysis, chunk: ServerChunk): string {
    switch (chunk.kind) {
        case 'static':
            return `  $out += ${JSON.stringify(chunk.text)};\n`
        case 'interp':
            // Trailing `<!---->` mirrors the client skeleton's per-leaf anchor (templatePlan.pushLeaf).
            return `  $out += $rt.renderValue(await (${chunk.expr})) + "<!---->";\n`
        case 'html':
            return `  $out += $rt.rawValue(await (${chunk.expr})) + "<!---->";\n`
        case 'await':
            return `  $out += $rt.renderValue(await (${chunk.expr})) + "<!---->";\n`
        case 'style':
            return `  $out += ${JSON.stringify(`<style>${chunk.css}</style>`)};\n`
        case 'element':
            return genElement(
                analysis,
                chunk.name,
                chunk.void,
                chunk.attrs,
                chunk.children,
                chunk.scopeAttr,
            )
        case 'component':
            return genComponent(
                analysis,
                chunk.name,
                chunk.attrs,
                chunk.children,
                chunk.hasChildren,
            )
        case 'if': {
            let out = '  {\n    let $r = "";\n'
            let first = true
            let hasElse = false
            for (const branch of chunk.branches) {
                if (branch.expr === null) {
                    out += `    else { $r = await ${bodyExpr(analysis, branch.children)}($scope); }\n`
                    hasElse = true
                } else {
                    out += `    ${first ? 'if' : 'else if'} (await (${branch.expr})) { $r = await ${bodyExpr(analysis, branch.children)}($scope); }\n`
                    first = false
                }
            }
            void hasElse
            out += '    $out += $r;\n  }\n'
            return out
        }
        case 'for': {
            let body = `    const $c = Object.create($scope);\n`
            body += `    ${bindPattern('$c', chunk.item, '$value')}\n`
            if (chunk.index !== null) body += `    $c[${JSON.stringify(chunk.index)}] = $i;\n`
            body += `    $out += await ${bodyExpr(analysis, chunk.children)}($c);\n    $i++;\n`
            if (chunk.await) {
                // STREAMING `{#for await}` (streaming-ssr-plan.md PR6): `$rt.forAwaitStream` drains the source up
                // to the deadline INLINE (a fast/synchronous stream stays byte-identical to the buffered drain),
                // then appends each subsequent item into an `<abide-list>` as a patch, marking it complete iff
                // the source ends within the budget. No stream scope (direct `render()`) → it drains fully inline.
                const itemBind =
                    `const $c = Object.create($scope);\n      ${bindPattern('$c', chunk.item, '$value')}\n` +
                    (chunk.index !== null ? `      $c[${JSON.stringify(chunk.index)}] = $i;\n` : '')
                const renderItem = `async ($value, $i) => {\n      ${itemBind}      return await ${bodyExpr(analysis, chunk.children)}($c);\n    }`
                const caught = chunk.catch
                    ? `async ($e) => {\n      ${childScopeCode('$cc', chunk.catch.param, '$e').replace(/\n/g, '\n      ')}      return await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n    }`
                    : 'null'
                // §5 attach tag: when the source head is a known RPC import, carry `{ attachable, rpcName, args }`
                // so `forAwaitStream` seeds a `StreamHandle` and the client adopts/resumes instead of re-running.
                // A non-RPC source adds NOTHING here → the emitted call is byte-identical to the pre-§5 output.
                const attach = parseAttachSource(chunk.iterable, rpcImportLocals(analysis))
                let attachTag = ''
                if (attach !== null) {
                    const argsExpr = attach.args.trim() === '' ? 'undefined' : attach.args
                    attachTag = `, attachable: true, rpcName: ${JSON.stringify(attach.rpcName)}, args: async () => (${argsExpr})`
                }
                return `  $out += await $rt.forAwaitStream({ source: () => (${chunk.iterable}), renderItem: ${renderItem}, caught: ${caught}${attachTag} });\n`
            }
            let out = '  $out += await (async ($scope) => {\n    let $out = "";\n    let $i = 0;\n'
            out += `    const $src = await (${chunk.iterable});\n`
            out += `    for (const $value of ($src ?? [])) {\n${body}    }\n`
            out += '    return $out;\n  })($scope);\n'
            return out
        }
        case 'awaitBlock': {
            // STREAMING form — the full `{#await}{:then}` block (streaming-ssr-plan.md decision 4). Defer to
            // `$rt.awaitStream`: it races the read against the per-render deadline, renders inline when the
            // read settles in time (byte-identical to the blocking path for warm/fast reads), or emits an
            // `<abide-slot>` placeholder + streams the resolved subtree as an out-of-order patch when slow.
            // No stream scope (direct `render()` in tests) → it awaits fully inline, so those stay identical.
            if (!chunk.inline) {
                const resolved = chunk.then
                    ? `async ($value) => {\n${childScopeCode('$ct', chunk.then.param, '$value')}      return await ${bodyExpr(analysis, chunk.then.children)}($ct);\n    }`
                    : `async ($value) => await ${bodyExpr(analysis, chunk.pending)}($scope)`
                const pending = `async () => await ${bodyExpr(analysis, chunk.pending)}($scope)`
                const caught = chunk.catch
                    ? `async ($e) => {\n${childScopeCode('$cc', chunk.catch.param, '$e')}      return await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n    }`
                    : 'null'
                const finalize = chunk.finally
                    ? `async () => await ${bodyExpr(analysis, chunk.finally)}($scope)`
                    : 'null'
                return `  $out += await $rt.awaitStream({ read: async () => (${chunk.expr}), resolved: ${resolved}, pending: ${pending}, caught: ${caught}, finalize: ${finalize} });\n`
            }
            // BLOCKING inline shorthand `{#await p then v}` / `{#await p catch e}` — await fully, render inline.
            let out = '  $out += await (async ($scope) => {\n    let $out = "";\n    try {\n'
            out += `      const $value = await (${chunk.expr});\n`
            if (chunk.then) {
                out +=
                    '      ' +
                    childScopeCode('$ct', chunk.then.param, '$value').replace(/\n/g, '\n      ')
                out += `      $out += await ${bodyExpr(analysis, chunk.then.children)}($ct);\n`
            } else {
                out += `      $out += await ${bodyExpr(analysis, chunk.pending)}($scope);\n`
            }
            out += '    } catch ($e) {\n'
            if (chunk.catch) {
                out +=
                    '      ' +
                    childScopeCode('$cc', chunk.catch.param, '$e').replace(/\n/g, '\n      ')
                out += `      $out += await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n`
            } else {
                out += '      throw $e;\n'
            }
            out += '    }\n'
            if (chunk.finally)
                out += `    $out += await ${bodyExpr(analysis, chunk.finally)}($scope);\n`
            out += '    return $out;\n  })($scope);\n'
            return out
        }
        case 'switch': {
            let out = '  $out += await (async ($scope) => {\n'
            out += `    const $subject = await (${chunk.discriminant});\n`
            for (const c of chunk.cases) {
                if (c.expr === null) continue
                out += `    if ((await (${c.expr})) === $subject) return await ${bodyExpr(analysis, c.children)}($scope);\n`
            }
            const fallback = chunk.cases.find((c) => c.expr === null)
            if (fallback)
                out += `    return await ${bodyExpr(analysis, fallback.children)}($scope);\n`
            out += '    return "";\n  })($scope);\n'
            return out
        }
        case 'try': {
            let out = '  $out += await (async ($scope) => {\n    let $out = "";\n    try {\n'
            out += `      $out = await ${bodyExpr(analysis, chunk.children)}($scope);\n`
            out += '    } catch ($e) {\n'
            if (chunk.catch) {
                out +=
                    '      ' +
                    childScopeCode('$cc', chunk.catch.param, '$e').replace(/\n/g, '\n      ')
                out += `      $out = await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n`
            } else {
                out += '      throw $e;\n'
            }
            out += '    }\n'
            if (chunk.finally)
                out += `    $out += await ${bodyExpr(analysis, chunk.finally)}($scope);\n`
            out += '    return $out;\n  })($scope);\n'
            return out
        }
        case 'snippet':
            return '' // registered up front by genChunks
    }
}

// Register snippet builders (hoisted) then emit the non-snippet chunks in order.
function genChunks(analysis: ScopeAnalysis, chunks: ServerChunk[]): string {
    let out = ''
    for (const chunk of chunks) {
        if (chunk.kind !== 'snippet') continue
        const patterns = chunk.params.trim() === '' ? [] : splitParams(chunk.params)
        let binds = ''
        for (const [i, pattern] of patterns.entries())
            binds += `    ${bindPattern('$s', pattern, `$args[${i}]`)}\n`
        out += `  $scope[${JSON.stringify(chunk.name)}] = async (...$args) => {\n    const $s = Object.create($scope);\n${binds}    return new $rt.Raw(await ${bodyExpr(analysis, chunk.children)}($s));\n  };\n`
    }
    for (const chunk of chunks) {
        if (chunk.kind === 'snippet') continue
        out += genChunk(analysis, chunk)
    }
    return out
}

// Split a snippet parameter list at top-level commas.
function splitParams(params: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < params.length; i++) {
        const char = params[i]
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (char === ',' && depth === 0) {
            parts.push(params.slice(start, i).trim())
            start = i + 1
        }
    }
    parts.push(params.slice(start).trim())
    return parts.filter((p) => p !== '')
}

export function emitServerModule(plan: TemplatePlan, analysis: ScopeAnalysis): string {
    // `.abide` component imports stay REAL ES imports (specifier rewritten by the loader to the compiled
    // component server module). The local is lexical (`declared`) so `<Card>` resolves to this binding.
    let componentImports = ''
    for (const entry of analysis.componentImports) {
        componentImports += `import ${entry.local} from ${JSON.stringify(entry.specifier)};\n`
    }
    // Pass-through framework imports (`abide/shared/online`, …) stay REAL ES imports too — resolved by
    // the temp-module dynamic import against abide's package exports (M3b).
    let moduleImports = ''
    for (const binding of analysis.moduleImports) {
        moduleImports += `${reconstructImport(binding)}\n`
    }
    return (
        `import * as $rt from "abide/ui/internal/serverRuntime";\n` +
        componentImports +
        moduleImports +
        `\n` +
        emitModuleEnsure(analysis) +
        `\nexport async function render($scope) {\n` +
        emitInstanceSetup(analysis) +
        `  let $out = "";\n` +
        genChunks(analysis, plan.serverChunks) +
        `  return $out;\n}\n` +
        // Default component adapter — emitted for EVERY module (pages import `{render}` and ignore it). A
        // consumer `<Card>` invokes this: build a child scope inheriting the caller's `$parent` scope,
        // install the caller's props as `props()` and children as `children`, then reuse this module's own
        // `render`; the result is wrapped in `$rt.Raw` so the caller splices it verbatim.
        `\nexport default async (props, childrenFn, $parent) => {\n` +
        `  const $s = Object.create($parent ?? null);\n` +
        `  $s.props = () => props;\n` +
        `  $s.children = childrenFn;\n` +
        `  return new $rt.Raw(await render($s));\n` +
        `};\n`
    )
}
