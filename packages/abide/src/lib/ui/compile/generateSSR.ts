import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { groupBindParts } from './groupBindParts.ts'
import { lowerContext } from './lowerContext.ts'
import { partitionSlots } from './partitionSlots.ts'
import { scopeAttr } from './scopeAttr.ts'
import { staticAttr } from './staticAttr.ts'
import { staticAttrValue } from './staticAttrValue.ts'
import { staticTextPart } from './staticTextPart.ts'
import { stripEffects } from './stripEffects.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

/* The range boundary comments a control-flow block emits around its content. They
   serialize exactly as the client's `document.createComment('[' | ']')` markers, so
   the client claims the same `[ … ]` boundary it builds — the comment-marked range
   that lets a branch hold any content. */
const RANGE_OPEN = '<!--[-->'
const RANGE_CLOSE = '<!--]-->'

/*
Server code generator: turns the parsed template into statements that push HTML
fragments onto an output array, reading the document synchronously (no DOM, no
listeners). Same expression lowering as the client back-end, so server and client
render the same markup. Dynamic values go through `$esc`; `if` is a plain `if`,
`each` a `for…of`.

An `await` block emits boundary comments (`<!--abide:await:N-->…<!--/abide:await:N-->`)
and registers the promise plus its resolved/error string-renderers on `$awaits`. A
streaming block (no `then` on the tag) puts its pending branch between the markers;
`renderToStream` flushes each resolved fragment out of order — the await-block-streams
half of the cache rule. A blocking block (`then` on the tag) emits an empty boundary
and flags the entry, so `renderToStream` settles it before the first flush.
*/
export function generateSSR(
    nodes: TemplateNode[],
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    isLayout = false,
): string {
    /* Compile-time counter for unique temp var names (runtime block ids, child render
       results) — block ids themselves are allocated at runtime via nextBlockId(). */
    let varCounter = 0
    const nextVar = (prefix: string): string => `${prefix}${varCounter++}`

    /* The shared signal→`model` lowering + branch-scoped nested-script deref scope. */
    const {
        expression: lowerExpression,
        statement,
        withNestedScripts,
    } = lowerContext(stateNames, derivedNames)

    /* A scoped-script body for SSR: the shared lowering, then strip effects
       (client-only lifecycle that emits no HTML) — the one SSR-side asymmetry. */
    const lowerScript = (code: string): string => stripEffects(statement(code))

    function push(target: string, literal: string): string {
        return `${target}.push(${JSON.stringify(literal)});\n`
    }

    function generateInto(children: TemplateNode[], target: string): string {
        return children.map((child) => generate(child, target)).join('')
    }

    /* A control-flow branch's content, generated exactly like a normal child list so
       a branch holds ANY content (components, text, nested blocks). `generate` emits
       nested `<script>`s in document order; `withNestedScripts` puts their bindings in
       scope — matching the client build, so hydration stays aligned. The caller wraps
       it in the `[ … ]` range markers the runtime tracks (unconditionally per block,
       so an empty/false branch still emits the boundary the client claims). */
    function branchContent(children: TemplateNode[], target: string): string {
        return withNestedScripts(children, () => generateInto(children, target))
    }
    const openRange = (target: string): string => push(target, RANGE_OPEN)
    const closeRange = (target: string): string => push(target, RANGE_CLOSE)

    function generate(node: TemplateNode, target: string): string {
        if (node.kind === 'text') {
            return node.parts
                .map((part) => {
                    if (part.kind === 'static') {
                        const markup = staticTextPart(part.value)
                        return markup === '' ? '' : push(target, markup)
                    }
                    return `${target}.push($text(${lowerExpression(part.code)}));\n`
                })
                .join('')
        }
        if (node.kind === 'if') {
            const elseBranch = node.children.find((child) => child.kind === 'case')
            const thenChildren = node.children.filter((child) => child.kind !== 'case')
            let code = `if (${lowerExpression(node.condition)}) {\n${branchContent(thenChildren, target)}}`
            if (elseBranch !== undefined && elseBranch.kind === 'case') {
                code += ` else {\n${branchContent(elseBranch.children, target)}}`
            }
            return `${openRange(target)}${code}\n${closeRange(target)}`
        }
        if (node.kind === 'switch') {
            const cases = node.children.filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            let code = `{ const $s = (${lowerExpression(node.subject)});\n`
            let started = false
            for (const branch of cases) {
                if (branch.match !== undefined) {
                    code += `${started ? 'else ' : ''}if ($s === (${lowerExpression(branch.match)})) {\n${branchContent(branch.children, target)}}\n`
                    started = true
                }
            }
            const fallback = cases.find((branch) => branch.match === undefined)
            if (fallback !== undefined) {
                code += `${started ? 'else ' : ''}{\n${branchContent(fallback.children, target)}}\n`
            }
            return `${openRange(target)}${code}}\n${closeRange(target)}`
        }
        if (node.kind === 'case') {
            return ''
        }
        if (node.kind === 'snippet') {
            /* A hoisted function returning the snippet's `$snip`-branded HTML string;
               `{name(args)}` pushes it via `$text`, which wraps it in markers. */
            const body = generateInto(node.children, '$o')
            return `function ${node.name}(${node.params ?? ''}) {\nconst $o = [];\n${body}return $snip($o.join(''));\n}\n`
        }
        if (node.kind === 'script') {
            /* A scoped reactive block: re-seed its local signals (lowered, in scope)
               so SSR renders the same values the client build will. */
            return `${lowerScript(node.code)}\n`
        }
        /* A `<style>` emits no markup — its scope attribute is already on the elements
           it covers (above) and its CSS is bundled, not inlined. */
        if (node.kind === 'style') {
            return ''
        }
        if (node.kind === 'each') {
            /* Async each (`await`) is drained on the client — render no rows on the
               server (an infinite stream would hang SSR); the client inserts its anchor
               before the next sibling during hydration, like an empty sync each. */
            if (node.async) {
                return ''
            }
            return `for (const ${node.as} of (${lowerExpression(node.items)})) {\n${openRange(target)}${branchContent(node.children, target)}${closeRange(target)}}\n`
        }
        if (node.kind === 'await') {
            return generateAwait(node, target)
        }
        if (node.kind === 'try') {
            return generateTry(node, target)
        }
        if (node.kind === 'branch') {
            return ''
        }
        if (node.kind === 'component') {
            /* Server-render the child via its `render` and inline the HTML inside
               the same wrapper the client mounts into, so SSR and client agree.
               Props pass as thunks; slot content passes as a string-returning
               `$children` the child invokes from its <slot>. */
            const tag = node.name.toLowerCase()
            const parts = node.props.map(
                (prop) => `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`,
            )
            const groups = partitionSlots(node.children)
            const slotCode = generateInto(groups.default, '$slot')
            if (slotCode.trim() !== '') {
                parts.push(
                    `"$children": () => { const $slot = []; ${slotCode}return $slot.join(''); }`,
                )
            }
            if (groups.named.length > 0) {
                const entries = groups.named
                    .map((group) => {
                        const code = generateInto(group.nodes, '$slot')
                        return `${JSON.stringify(group.name)}: () => { const $slot = []; ${code}return $slot.join(''); }`
                    })
                    .join(', ')
                parts.push(`"$slots": { ${entries} }`)
            }
            /* Render the child and MERGE its await blocks into this page's `$awaits`
               so they join the page's SSR stream — their markers carry render-pass
               block ids (nextBlockId), unique across page + children, so the streamed
               fragments resolve into the right boundaries. ($awaits is captured from
               the enclosing render body, including from branch closures.) */
            const result = nextVar('$child')
            return (
                push(target, `<${tag}>`) +
                `const ${result} = ${node.name}.render({ ${parts.join(', ')} });\n` +
                `${target}.push(${result}.html);\n` +
                `for (const $a of ${result}.awaits) { $awaits.push($a); }\n` +
                push(target, `</${tag}>`)
            )
        }
        if (node.kind === 'element' && node.tag === 'slot') {
            /* A layout's unnamed `<slot/>` is the router's page outlet: emit an empty
               placeholder the chain composer folds the child layer's html into. */
            if (isLayout && staticAttrValue(node, 'name') === undefined) {
                return push(target, `<${OUTLET_TAG}></${OUTLET_TAG}>`)
            }
            return generateSlot(node, target)
        }
        let code = push(target, `<${node.tag}`)
        /* Every `<style>` active at this element (own siblings + ancestors) — same set
           the client stamps, so server and client markup carry identical attributes. */
        for (const scope of node.scopes ?? []) {
            code += push(target, scopeAttr(scope))
        }
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                code += push(target, staticAttr(attr.name, attr.value))
            } else if (attr.kind === 'expression') {
                /* present/absent semantics matching the client `attr` binding:
                   false/null/undefined drops it, true emits the bare attribute. */
                code += `${target}.push($attr(${JSON.stringify(attr.name)}, ${lowerExpression(attr.code)}));\n`
            } else if (attr.kind === 'bind' && attr.property === 'group') {
                /* Render the checked state as a boolean attribute: present when the
                   path holds (radio) or contains (checkbox) this control's value. */
                const { valueCode, isRadio } = groupBindParts(node)
                const present = isRadio
                    ? `(${lowerExpression(attr.code)}) === (${lowerExpression(valueCode)})`
                    : `(${lowerExpression(attr.code)}).includes(${lowerExpression(valueCode)})`
                code += `${target}.push((${present}) ? ' checked' : '');\n`
            } else if (attr.kind === 'bind' && attr.property === 'checked') {
                /* A boolean property — its mere presence means checked, so emit the
                   attribute only when truthy (a string `checked="false"` still checks). */
                code += `${target}.push((${lowerExpression(attr.code)}) ? ' checked' : '');\n`
            } else if (attr.kind === 'bind') {
                code += `${target}.push(${JSON.stringify(` ${attr.property}="`)} + $esc(${lowerExpression(attr.code)}) + '"');\n`
            }
        }
        code += push(target, '>')
        if (!VOID_TAGS.has(node.tag)) {
            /* A `<script>` child scopes its bindings to this element's subtree. */
            code += withNestedScripts(node.children, () => generateInto(node.children, target))
            code += push(target, `</${node.tag}>`)
        }
        return code
    }

    /* A `<slot>` outlet: emit the parent-provided content for this slot (default
       via `$children`, named via `$slots[name]`), falling back to the slot's own
       children when none was supplied. */
    function generateSlot(
        node: Extract<TemplateNode, { kind: 'element' }>,
        target: string,
    ): string {
        const name = staticAttrValue(node, 'name')
        const guard =
            name === undefined
                ? '$props && $props.$children'
                : `$props && $props.$slots && $props.$slots[${JSON.stringify(name)}]`
        const provided =
            name === undefined ? '$props.$children' : `$props.$slots[${JSON.stringify(name)}]`
        const fallback = generateInto(node.children, target)
        if (fallback.trim() === '') {
            return `if (${guard}) { ${target}.push(${provided}()); }\n`
        }
        return `if (${guard}) { ${target}.push(${provided}()); } else {\n${fallback}}\n`
    }

    /* Boundary markers + a `$awaits` registration carrying the promise and
       string-renderers for the resolved/error branches. Streaming emits the pending
       branch between the markers (flushed now, value streamed later); blocking emits
       an empty boundary — its resolved branch is the children bound to `node.as` — and
       flags the entry so `renderToStream` settles it before the first flush. */
    function generateAwait(node: Extract<TemplateNode, { kind: 'await' }>, target: string): string {
        const branchOf = (which: 'then' | 'catch' | 'finally') =>
            node.children.find(
                (child): child is Extract<TemplateNode, { kind: 'branch' }> =>
                    child.kind === 'branch' && child.branch === which,
            )
        const catchBranch = branchOf('catch')
        const finallyChildren = branchOf('finally')?.children ?? []
        /* Resolved branch + its bound value: the children directly when blocking, the
           `then` child when streaming. Pending (streaming only) is the non-branch
           children. */
        const thenBranch = branchOf('then')
        const resolvedChildren = node.blocking
            ? node.children.filter((child) => child.kind !== 'branch')
            : (thenBranch?.children ?? [])
        const resolvedAs = node.blocking ? node.as : thenBranch?.as
        const pending = node.blocking
            ? []
            : node.children.filter((child) => child.kind !== 'branch')
        /* Runtime block id (shared with the client + child components in this pass). */
        const id = nextVar('$aid')
        let code = `const ${id} = nextBlockId();\n`
        code += `${target}.push("<!--abide:await:" + ${id} + "-->");\n`
        code += branchContent(pending, target)
        code += `${target}.push("<!--/abide:await:" + ${id} + "-->");\n`
        /* The settled closures append `finally` after the outcome markup, matching the
           client's concatenated node range so hydration aligns. */
        const settled = (binding: string, children: TemplateNode[]) =>
            `(${binding}) => { const $o = []; ${branchContent(children, '$o')}${branchContent(finallyChildren, '$o')}return $o.join(''); }`
        /* Neither catch nor finally → omit `catch` so a rejection surfaces to the
           stream/error path (renderToStream re-throws) instead of rendering an empty
           branch. A finally-only block keeps a catch closure that renders just finally. */
        const catchProp =
            catchBranch === undefined && finallyChildren.length === 0
                ? ''
                : `catch: ${settled(catchBranch?.as ?? '_error', catchBranch?.children ?? [])} `
        code +=
            `$awaits.push({ id: ${id}, ` +
            (node.blocking ? 'blocking: true, ' : '') +
            `promise: () => (${lowerExpression(node.promise)}), ` +
            `then: ${settled(resolvedAs ?? '_value', resolvedChildren)}, ` +
            `${catchProp}});\n`
        return code
    }

    /* A sync error boundary: push the guarded markup (++ finally) inside a real
       try/catch; on a throw, truncate the output back to the boundary start and push
       the catch markup (++ finally) instead — so even mid-stream a render throw
       becomes catch markup, not a broken response. No catch re-throws (propagates to
       an enclosing boundary / the 500 / the stream). Boundary comments let hydration
       discard the server content if the client adoption fails. */
    function generateTry(node: Extract<TemplateNode, { kind: 'try' }>, target: string): string {
        const branchOf = (which: 'catch' | 'finally') =>
            node.children.find(
                (child): child is Extract<TemplateNode, { kind: 'branch' }> =>
                    child.kind === 'branch' && child.branch === which,
            )
        const catchBranch = branchOf('catch')
        const finallyChildren = branchOf('finally')?.children ?? []
        const guarded = node.children.filter((child) => child.kind !== 'branch')
        const errName = catchBranch?.as ?? '_error'
        const id = nextVar('$tid')
        const mark = nextVar('$trim')
        let code = `const ${id} = nextBlockId();\n`
        code += `${target}.push("<!--abide:try:" + ${id} + "-->");\n`
        code += `const ${mark} = ${target}.length;\n`
        code += `try {\n`
        code += branchContent(guarded, target)
        code += branchContent(finallyChildren, target)
        code += `} catch (${errName}) {\n${target}.length = ${mark};\n`
        if (catchBranch !== undefined) {
            code += branchContent(catchBranch.children, target)
            code += branchContent(finallyChildren, target)
        } else {
            code += `throw ${errName};\n`
        }
        code += `}\n`
        code += `${target}.push("<!--/abide:try:" + ${id} + "-->");\n`
        return code
    }

    return generateInto(nodes, '$out')
}
