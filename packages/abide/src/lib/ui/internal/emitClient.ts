// `.abide` CLIENT MODULE EMITTER (Stage 1, PR3) — produces a browser-shippable ES-module string.
//
// Turns a `TemplatePlan` + `ScopeAnalysis` into `import * as $rt from "abide/ui/internal/runtime"`,
// module-level `$rt.template(...)` skeletons, and `export function mount($target, $scope)` that clones
// each template, walks a cursor (firstChild/nextSibling steps from the plan's `path`) to every dynamic
// node, and wires the `$rt.*` helpers with real-identifier thunks. Block/component/snippet bodies are
// nested mount functions (so lexical `<script>` cells are captured) selected by clone id. Also emits
// `export function hydrate($container, $scope)` (Stage 2): the same build walk over a cursor seeded on
// the server DOM — claiming existing nodes with suppress-initial-write, localized mismatch recovery,
// and a whole-page fresh-`mount` fallback as last resort.
//
// No `new Function`, no `with`; script cells are lexical `let n = state(0)` with references rewritten to
// `.read()/.write()`, and free/block-bound template identifiers read off `$scope`.

import type { ScopeAnalysis } from './analyzeScope.ts'
import { extractBindingNames, reconstructImport } from './analyzeScope.ts'
import { emitInstanceSetup, emitModuleEnsure } from './emitSetup.ts'
import type { AttrPlan, ClientPlan, DynamicSlot, TemplatePlan } from './templatePlan.ts'

function componentRef(analysis: ScopeAnalysis, name: string): string {
    return analysis.declared.has(name) ? name : `$scope.${name}`
}

// Slot kinds that occupy a single `<!---->` leaf position in a level (a value node + its anchor).
const LEAF_KINDS = new Set<string>(['interpolation', 'html', 'await'])
// Slot kinds wrapped in paired `<!--[-->…<!--]-->` block anchors (2 child positions: open, close).
const BLOCK_KINDS = new Set<string>(['if', 'for', 'switch', 'try', 'awaitBlock', 'component'])

function isSimpleIdentifier(pattern: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(pattern.trim())
}

// Statement(s) binding `pattern` from `valueExpr` onto scope object `target`.
function bindPattern(target: string, pattern: string, valueExpr: string): string {
    const trimmed = pattern.trim()
    if (isSimpleIdentifier(trimmed)) return `${target}[${JSON.stringify(trimmed)}] = ${valueExpr};`
    const names = extractBindingNames(trimmed)
    return `Object.assign(${target}, (() => { const ${trimmed} = ${valueExpr}; return { ${names.join(', ')} }; })());`
}

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

// ---------------------------------------------------------------------------
// Emitter (collects sub-plans → clone ids → mount functions)
// ---------------------------------------------------------------------------

class ClientEmitter {
    private analysis: ScopeAnalysis
    private planIds = new Map<ClientPlan, number>()
    private plans: { id: number; plan: ClientPlan }[] = []

    constructor(analysis: ScopeAnalysis) {
        this.analysis = analysis
    }

    private idFor(plan: ClientPlan): number {
        const existing = this.planIds.get(plan)
        if (existing !== undefined) return existing
        const id = this.plans.length
        this.planIds.set(plan, id)
        this.plans.push({ id, plan })
        return id
    }

    emit(plan: TemplatePlan): string {
        const rootPlan: ClientPlan = {
            skeleton: plan.skeletonClient,
            slots: plan.slots,
            elementTags: plan.elementTags,
        }
        this.idFor(rootPlan) // id 0
        // Generating mount fns grows `this.plans` as sub-plans are discovered.
        let fns = ''
        for (const { id, plan: subPlan } of this.plans) {
            fns += this.genMountFn(id, subPlan)
        }
        let templates = ''
        for (const { id, plan: p } of this.plans) {
            templates += `const $tmpl${id} = $rt.template(${JSON.stringify(p.skeleton)});\n`
        }
        // Side-effect CSS imports (`import "./styles.css"`) come FIRST so `Bun.build` sees and bundles the
        // CSS (emitted verbatim; the client bundle rewrites relative specifiers to absolute paths). The
        // server module never emits these — CSS is client-only. Class names live in the template regardless.
        let cssImports = ''
        for (const specifier of this.analysis.cssImports) {
            cssImports += `import ${JSON.stringify(specifier)};\n`
        }
        // `.abide` component imports stay REAL ES imports (specifier rewritten by the loader/bundler to the
        // compiled component module). The local is lexical (`declared`) so `<Card>` resolves to this binding.
        let componentImports = ''
        for (const entry of this.analysis.componentImports) {
            componentImports += `import ${entry.local} from ${JSON.stringify(entry.specifier)};\n`
        }
        // Pass-through framework imports (`abide/shared/online`, `abide/ui/bundled`, …) stay REAL ES
        // imports too — resolved by Bun.build against abide's package exports (M3b).
        let moduleImports = ''
        for (const binding of this.analysis.moduleImports) {
            moduleImports += `${reconstructImport(binding)}\n`
        }
        return (
            cssImports +
            componentImports +
            moduleImports +
            `import * as $rt from "abide/ui/internal/runtime";\n\n` +
            templates +
            '\n' +
            emitModuleEnsure(this.analysis) +
            // `$anchor` (optional, TODO #7): when this module is mounted as a composed layer (a layout
            // wrapping the next level via its `{children()}` component slot), the enclosing `$rt.component`
            // passes its marker so the level inserts before it / bounds its claimRoots correctly. Top-level
            // callers (bootstrap, tests) omit it → null, the original whole-container behaviour.
            `\nexport function mount($target, $scope, $anchor) {\n` +
            emitInstanceSetup(this.analysis) +
            indent(fns, 2) +
            `  return $mount0($target, $anchor === undefined ? null : $anchor, $scope);\n` +
            `}\n\n` +
            // Whole-page fallback (PR6, decision 5): if a mismatch escapes every block-level recovery (the
            // root structure itself is wrong), clear the container and mount fresh. Hydration NEVER throws to
            // the caller or leaves the page corrupted. `endHydration` runs before the fresh mount so it CLONES.
            // Any failure in the claim pass — a thrown `HydrationMismatch` that escaped every block-level
            // recovery, OR a cursor that desynced hard (e.g. a null the walk still dereferenced) — falls back
            // to a clean fresh mount. Hydration NEVER throws to the caller or leaves the page corrupted;
            // `endHydration` runs before the fresh mount so it CLONES. The fresh mount is the last resort: if
            // IT throws, that error propagates (a genuine bug, not a hydration artifact).
            `export function hydrate($container, $scope) {\n` +
            `  $rt.startHydration($container);\n` +
            `  try {\n` +
            `    return mount($container, $scope);\n` +
            `  } catch ($error) {\n` +
            `    $rt.endHydration();\n` +
            `    $rt.warnHydrationMismatch("the page root", $error);\n` +
            `    $container.textContent = "";\n` +
            `    return mount($container, $scope);\n` +
            `  } finally {\n` +
            `    $rt.endHydration();\n` +
            `  }\n` +
            `}\n` +
            // Default component adapter — emitted for EVERY module (pages import `{mount,hydrate}` and ignore
            // it). A consumer `<Card>` invokes this: build a child scope inheriting the caller's `$parent`
            // scope (so `state`/`watch`/RPC proxies/`route`/`url` are the SAME seeded wrappers → hydration
            // seed ordinals stay aligned), install the caller's props as `props()` and children as
            // `children`, then reuse this module's own `mount`. Marker-bounded claim happens inside `mount`
            // (`$mount0` branches on `$rt.hydrating`), so hydration works with no new code.
            `\nexport default (props, childrenFn, $parent) => ({ mount: ($p, $a) => {\n` +
            `  const $s = Object.create($parent ?? null);\n` +
            `  $s.props = () => props;\n` +
            `  $s.children = childrenFn;\n` +
            `  return mount($p, $s, $a);\n` +
            `} });\n`
        )
    }

    // A mount function for one template level. Two node-locating strategies feed the SAME `let $n…`
    // variables the wiring reads: the CLONE path walks the cloned skeleton by positional index (PR1/PR3
    // — proven, unchanged); the HYDRATE path walks the ACTUAL server DOM with the stateful cursor
    // (`runtime.hydrateCursor`), so counts that differ from the clone (adjacent leaves, block bodies)
    // stay in sync. Both are emitted; `$rt.hydrating` picks one at call time.
    private genMountFn(id: number, plan: ClientPlan): string {
        const neededPaths = new Map<string, number[]>()
        const register = (path: number[]): string => {
            const key = path.join('_')
            if (!neededPaths.has(key)) neededPaths.set(key, path)
            return `$n${key}`
        }
        // `nav(path)` — the node-variable for a child path (registered so BOTH strategies assign it).
        const nav = (path: number[]): string => (path.length === 0 ? '$target' : register(path))
        const parentOf = (path: number[]): string =>
            path.length <= 1 ? '$target' : nav(path.slice(0, -1))

        // Tag names for dynamic elements at this template level, keyed by path — threaded from the plan so
        // the hydrate walk can emit a cheap `claimElement($node, "button")` tag assertion (decision 5).
        const tags = new Map<string, string>()
        for (const entry of plan.elementTags ?? []) tags.set(entry.path.join('_'), entry.tag)

        let wiring = ''
        // Snippet definitions first (hoisted).
        for (const slot of plan.slots) {
            if (slot.kind === 'snippet') wiring += this.genSnippet(slot)
        }
        for (const slot of plan.slots) {
            if (slot.kind === 'snippet') continue
            wiring += this.genSlot(slot, nav, parentOf)
        }

        // Ancestor prefixes of every referenced path need their own intermediate variable.
        for (const path of Array.from(neededPaths.values())) {
            for (let len = 1; len < path.length; len++) register(path.slice(0, len))
        }
        const allPaths = Array.from(neededPaths.values())
        const decls =
            allPaths.length > 0
                ? `  let ${allPaths.map((p) => `$n${p.join('_')}`).join(', ')};\n`
                : ''

        return (
            `function $mount${id}($target, $anchor, $scope) {\n` +
            `  const $sink = [];\n` +
            // Capture the cursor position that sits AFTER this level's structural walk, so it can be restored
            // once the wiring runs. Wiring for a nested block (try/await/if/switch/for) RESEEKS the module
            // cursor to claim its own body — leaving it mid-region. A caller that reads `hydrateNode()` after
            // this mount fn returns (a keyed `{#for}` positioning its per-item end marker) would otherwise
            // land inside the item and scramble the DOM. Restoring the post-walk cursor keeps the extent this
            // level consumed exact. Inner blocks reseek from their OWN anchors, so they are unaffected.
            `  const $wasHydrating = $rt.hydrating;\n` +
            `  let $resume = null;\n` +
            decls +
            `  let $roots;\n` +
            `  if ($rt.hydrating) {\n` +
            `    const $forItem = $rt.consumeForItem();\n` +
            `    const $start = $rt.hydrateNode();\n` +
            indent(this.genHydrateLevel(plan.slots, [], tags), 4) +
            // Roots for teardown: bounded by the mount fn's anchor (root → to end; block body → its marker),
            // or by the post-walk cursor for a keyed for-item (whose exact extent isn't known up front).
            `    $roots = $rt.claimRoots($start, $forItem ? $rt.hydrateNode() : $anchor);\n` +
            `    $resume = $rt.hydrateNode();\n` +
            `  } else {\n` +
            `    const $frag = $tmpl${id}.content.cloneNode(true);\n` +
            indent(this.genClonePositional(allPaths), 4) +
            `    $roots = Array.from($frag.childNodes);\n` +
            `    $rt.finalize($frag, $target, $anchor);\n` +
            `  }\n` +
            wiring +
            `  if ($wasHydrating) $rt.hydrateSeek($resume);\n` +
            `  return () => { for (const $d of $sink) $d(); for (const $r of $roots) $rt.remove($r); };\n` +
            `}\n`
        )
    }

    // Positional clone walk (unchanged semantics): assign each `$n…` from `firstChild`/`nextSibling`
    // steps off the cloned fragment. Ancestors first (sorted by depth) so parent vars exist.
    private genClonePositional(paths: number[][]): string {
        const sorted = paths
            .slice()
            .sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')))
        let code = ''
        for (const path of sorted) {
            const parent = path.length === 1 ? '$frag' : `$n${path.slice(0, -1).join('_')}`
            const last = path[path.length - 1]
            if (last === undefined) throw new Error('clone path must be non-empty')
            let expr = `$rt.firstChild(${parent})`
            for (let i = 0; i < last; i++) expr = `$rt.nextSibling(${expr})`
            code += `$n${path.join('_')} = ${expr};\n`
        }
        return code
    }

    // Stateful-cursor hydrate walk for one level (path prefix). Emits, in document order: static skips
    // between dynamic children, leaf claims (advance past value + `<!---->`), element descents (recurse
    // then step to the element's next sibling), and block open/close capture (find the matching
    // `<!--]-->`, step past it). Every `$n…` the wiring reads is assigned here for server DOM.
    private genHydrateLevel(
        slots: DynamicSlot[],
        prefix: number[],
        tags: Map<string, string>,
    ): string {
        const depth = prefix.length
        const groups = new Map<number, DynamicSlot[]>()
        for (const slot of slots) {
            if (slot.kind === 'snippet' || slot.path.length <= depth) continue
            let matches = true
            for (let i = 0; i < depth; i++) {
                if (slot.path[i] !== prefix[i]) {
                    matches = false
                    break
                }
            }
            if (!matches) continue
            const index = slot.path[depth]
            if (index === undefined) throw new Error('slot path is shorter than its level depth')
            const bucket = groups.get(index)
            if (bucket === undefined) groups.set(index, [slot])
            else bucket.push(slot)
        }

        interface Entry {
            start: number
            index: number
            kind: 'leaf' | 'element' | 'block'
            leafKind?: string
        }
        const entries: Entry[] = []
        for (const [index, bucket] of groups) {
            const here = bucket.filter((s) => s.path.length === depth + 1)
            const blockSlot = here.find((s) => BLOCK_KINDS.has(s.kind))
            const leafSlot = here.find((s) => LEAF_KINDS.has(s.kind))
            if (blockSlot !== undefined) entries.push({ start: index - 1, index, kind: 'block' })
            else if (leafSlot !== undefined)
                entries.push({ start: index, index, kind: 'leaf', leafKind: leafSlot.kind })
            else entries.push({ start: index, index, kind: 'element' })
        }
        entries.sort((a, b) => a.start - b.start)

        let code = ''
        let expected = 0
        for (const entry of entries) {
            const skip = entry.start - expected
            if (skip > 0) code += `$rt.hydrateSkip(${skip});\n`
            if (entry.kind === 'leaf') {
                const varName = `$n${[...prefix, entry.index].join('_')}`
                const claim = entry.leafKind === 'html' ? 'hydrateHtmlAnchor' : 'hydrateValueLeaf'
                code += `${varName} = $rt.${claim}();\n`
                expected = entry.index + 1
            } else if (entry.kind === 'element') {
                const path = [...prefix, entry.index]
                const varName = `$n${path.join('_')}`
                // Cheap always-on tag assertion at a dynamic element (decision 5); recovers via the enclosing
                // block/root when the server's tag differs. Purely-static container elements never reach here.
                const tag = tags.get(path.join('_'))
                if (tag !== undefined)
                    code += `${varName} = $rt.claimElement($rt.hydrateNode(), ${JSON.stringify(tag)});\n`
                else code += `${varName} = $rt.hydrateNode();\n`
                code += `$rt.hydrateSeek($rt.firstChild(${varName}));\n`
                code += this.genHydrateLevel(slots, path, tags)
                code += `$rt.hydrateSeek($rt.nextSibling(${varName}));\n`
                expected = entry.index + 1
            } else {
                const openVar = `$n${[...prefix, entry.index - 1].join('_')}`
                const closeVar = `$n${[...prefix, entry.index].join('_')}`
                code += `${openVar} = $rt.hydrateNode();\n`
                code += `${closeVar} = $rt.findBlockClose(${openVar});\n`
                code += `$rt.hydrateSeek(${closeVar} !== null ? $rt.nextSibling(${closeVar}) : null);\n`
                expected = entry.index + 1
            }
        }
        return code
    }

    // The OPEN `<!--[-->` anchor variable for a block/component slot (its close anchor is `slot.path`).
    private openRef(slot: DynamicSlot, nav: (p: number[]) => string): string {
        const path = slot.path
        const last = path[path.length - 1]
        if (last === undefined) throw new Error('block/component slot path must be non-empty')
        const openPath = [...path.slice(0, -1), last - 1]
        return nav(openPath)
    }

    private blockFn(plan: ClientPlan, scopeExpr: string): string {
        const id = this.idFor(plan)
        return `($p, $a) => $mount${id}($p, $a, ${scopeExpr})`
    }

    private mountable(plan: ClientPlan, scopeExpr: string): string {
        return `({ mount: ${this.blockFn(plan, scopeExpr)} })`
    }

    private genSnippet(slot: DynamicSlot): string {
        const name = slot.meta.name
        if (name === undefined) throw new Error('snippet slot is missing its name')
        const params = slot.meta.params ?? ''
        const patterns = params.trim() === '' ? [] : splitParams(params)
        let binds = ''
        for (const [i, pattern] of patterns.entries())
            binds += `    ${bindPattern('$s', pattern, `$args[${i}]`)}\n`
        const body = slot.meta.body
        if (body === undefined) throw new Error('snippet slot is missing its body')
        const bodyId = this.idFor(body)
        return (
            `  $scope[${JSON.stringify(name)}] = (...$args) => ({ mount: ($p, $a) => {\n` +
            `    const $s = Object.create($scope);\n` +
            binds +
            `    return $mount${bodyId}($p, $a, $s);\n` +
            `  } });\n`
        )
    }

    private genSlot(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const expr = slot.expr ?? ''
        switch (slot.kind) {
            case 'interpolation':
                return `  $sink.push($rt.interpolate(${parentOf(slot.path)}, ${nav(slot.path)}, () => (${expr}), ${slot.prefixLen ?? 0}));\n`
            case 'html':
                return `  $sink.push($rt.htmlBlock(${parentOf(slot.path)}, ${nav(slot.path)}, () => (${expr}), ${slot.prefixLen ?? 0}));\n`
            case 'await':
                return `  $sink.push($rt.awaitText(${parentOf(slot.path)}, ${nav(slot.path)}, () => (${expr}), ${slot.prefixLen ?? 0}));\n`
            case 'attr':
                return `  $sink.push($rt.setAttr(${nav(slot.path)}, ${JSON.stringify(slot.meta.name)}, () => (${expr})));\n`
            case 'event':
                return `  $sink.push($rt.listen(${nav(slot.path)}, ${JSON.stringify(slot.meta.event)}, () => (${expr})));\n`
            case 'class':
                return `  $sink.push($rt.toggleClass(${nav(slot.path)}, ${JSON.stringify(slot.meta.name)}, () => (${expr})));\n`
            case 'style':
                return `  $sink.push($rt.setStyleProp(${nav(slot.path)}, ${JSON.stringify(slot.meta.name)}, () => (${expr})));\n`
            case 'spread':
                return `  $sink.push($rt.spread(${nav(slot.path)}, () => (${expr})));\n`
            case 'bind':
                return this.genBind(slot, nav)
            case 'if':
                return this.genIf(slot, nav, parentOf)
            case 'switch':
                return this.genSwitch(slot, nav, parentOf)
            case 'for':
                return this.genFor(slot, nav, parentOf)
            case 'awaitBlock':
                return this.genAwaitBlock(slot, nav, parentOf)
            case 'try':
                return this.genTry(slot, nav, parentOf)
            case 'component':
                return this.genComponent(slot, nav, parentOf)
            default:
                return ''
        }
    }

    private genBind(slot: DynamicSlot, nav: (p: number[]) => string): string {
        const el = nav(slot.path)
        const name = slot.meta.name
        if (name === undefined) throw new Error('bind slot is missing its name')
        const expr = slot.expr
        if (expr === null) throw new Error('bind slot is missing its expression')
        if (name === 'element') {
            return `  { const $d = $rt.bindElement(${el}, (${expr})); if ($d !== undefined) $sink.push($d); }\n`
        }
        let helper = 'bindValue'
        if (name === 'group') helper = 'bindGroup'
        else if (name === 'checked') helper = 'bindChecked'
        return `  { const $acc = $rt.boundAccessor((${expr})); if ($acc !== null) $sink.push($rt.${helper}(${el}, $acc)); }\n`
    }

    private genIf(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const branchPlans = slot.meta.branches
        if (branchPlans === undefined) throw new Error('if slot is missing its branches')
        const branches = branchPlans
            .map((b) => {
                const condition = b.expr === null ? 'null' : `() => (${b.expr})`
                return `{ condition: ${condition}, body: ${this.blockFn(b.plan, '$scope')} }`
            })
            .join(', ')
        return `  $sink.push($rt.ifBlock(${parentOf(slot.path)}, ${this.openRef(slot, nav)}, ${nav(slot.path)}, [${branches}]));\n`
    }

    private genSwitch(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const casePlans = slot.meta.branches
        if (casePlans === undefined) throw new Error('switch slot is missing its cases')
        const cases = casePlans
            .map((c) => {
                const test = c.expr === null ? 'null' : `() => (${c.expr})`
                return `{ test: ${test}, body: ${this.blockFn(c.plan, '$scope')} }`
            })
            .join(', ')
        const leadingPlan = slot.meta.leading
        if (leadingPlan === undefined) throw new Error('switch slot is missing its leading nodes')
        const leading = this.blockFn(leadingPlan, '$scope')
        return `  $sink.push($rt.switchBlock(${parentOf(slot.path)}, ${this.openRef(slot, nav)}, ${nav(slot.path)}, () => (${slot.meta.discriminant}), ${leading}, [${cases}]));\n`
    }

    private genFor(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const item = slot.meta.item
        if (item === undefined) throw new Error('for slot is missing its item pattern')
        const index = slot.meta.index ?? null
        const key = slot.meta.key ?? null
        const simple = isSimpleIdentifier(item)
        const body = slot.meta.body
        if (body === undefined) throw new Error('for slot is missing its body')
        const bodyId = this.idFor(body)

        let keyFor: string
        if (key === null) {
            keyFor = '($value, $index) => $index'
        } else {
            let bindItem = `    ${bindPattern('$k', item, '$value')}\n`
            if (index !== null) bindItem += `    $k[${JSON.stringify(index)}] = $index;\n`
            // Rebind `$scope` to the temp item scope so the rewritten key expression resolves item/index.
            keyFor = `($value, $index) => {\n    const $k = Object.create($scope);\n${bindItem}    return (($scope) => (${key}))($k);\n  }`
        }

        let createItem = '($p, $start, $end, $value, $index) => {\n'
        createItem += '    const $itemSig = $rt.signal($value);\n'
        createItem += '    const $indexSig = $rt.signal($index);\n'
        createItem += '    const $child = Object.create($scope);\n'
        if (simple) {
            createItem += `    Object.defineProperty($child, ${JSON.stringify(item.trim())}, { get: () => $itemSig(), configurable: true });\n`
        } else {
            createItem += `    ${bindPattern('$child', item, '$value')}\n`
        }
        if (index !== null) {
            createItem += `    Object.defineProperty($child, ${JSON.stringify(index)}, { get: () => $indexSig(), configurable: true });\n`
        }
        createItem += `    const $dispose = $rt.untrack(() => $mount${bodyId}($p, $end, $child));\n`
        createItem += '    return {\n'
        createItem += '      update: ($v, $i) => { $itemSig.set($v); $indexSig.set($i);'
        if (!simple) createItem += ` ${bindPattern('$child', item, '$v')}`
        createItem += ' },\n'
        createItem += '      dispose: () => $dispose(),\n'
        createItem += '    };\n  }'

        let catchFn = 'null'
        if (slot.meta.catch) {
            const c = slot.meta.catch
            const child = c.param
                ? `(() => { const $c = Object.create($scope); ${bindPattern('$c', c.param, '$error')} return $c; })()`
                : '$scope'
            catchFn = `($error) => ${this.blockFn(c.plan, child)}`
        }

        return (
            `  $sink.push($rt.forBlock(${parentOf(slot.path)}, ${this.openRef(slot, nav)}, ${nav(slot.path)}, {\n` +
            `    read: () => (${slot.meta.iterable}),\n` +
            `    isAwait: ${slot.meta.await ? 'true' : 'false'},\n` +
            `    keyFor: ${keyFor},\n` +
            `    createItem: ${createItem},\n` +
            `    catch: ${catchFn},\n` +
            `  }));\n`
        )
    }

    private genAwaitBlock(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const pendingPlan = slot.meta.pending
        if (pendingPlan === undefined)
            throw new Error('await block slot is missing its pending branch')
        const pending = this.blockFn(pendingPlan, '$scope')
        const thenFn = slot.meta.then
            ? `($value) => ${this.paramBlockFn(slot.meta.then.plan, slot.meta.then.param, '$value')}`
            : 'null'
        const catchFn = slot.meta.catch
            ? `($error) => ${this.paramBlockFn(slot.meta.catch.plan, slot.meta.catch.param, '$error')}`
            : 'null'
        const finallyFn = slot.meta.finally ? this.blockFn(slot.meta.finally, '$scope') : 'null'
        return (
            `  $sink.push($rt.awaitBlock(${parentOf(slot.path)}, ${this.openRef(slot, nav)}, ${nav(slot.path)}, () => (${slot.expr}), {\n` +
            `    pending: ${pending},\n` +
            `    then: ${thenFn},\n` +
            `    catch: ${catchFn},\n` +
            `    finally: ${finallyFn},\n` +
            `  }));\n`
        )
    }

    private genTry(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const bodyPlan = slot.meta.body
        if (bodyPlan === undefined) throw new Error('try slot is missing its body')
        const body = this.blockFn(bodyPlan, '$scope')
        const catchFn = slot.meta.catch
            ? `($error) => ${this.paramBlockFn(slot.meta.catch.plan, slot.meta.catch.param, '$error')}`
            : 'null'
        const finallyFn = slot.meta.finally ? this.blockFn(slot.meta.finally, '$scope') : 'null'
        return `  $sink.push($rt.tryBlock(${parentOf(slot.path)}, ${this.openRef(slot, nav)}, ${nav(slot.path)}, ${body}, ${catchFn}, ${finallyFn}));\n`
    }

    // A BlockFn whose scope carries an optional single param binding.
    private paramBlockFn(plan: ClientPlan, param: string | null, valueExpr: string): string {
        if (param === null || param.trim() === '') return this.blockFn(plan, '$scope')
        const child = `(() => { const $c = Object.create($scope); ${bindPattern('$c', param, valueExpr)} return $c; })()`
        return this.blockFn(plan, child)
    }

    private genComponent(
        slot: DynamicSlot,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const name = slot.meta.name
        if (name === undefined) throw new Error('component slot is missing its name')
        const attrs = slot.meta.attrs ?? []
        let props = '  {\n    const $props = {};\n'
        for (const attr of attrs as AttrPlan[]) {
            switch (attr.kind) {
                case 'static':
                    props += `    $props[${JSON.stringify(attr.name)}] = ${attr.value === null ? 'true' : JSON.stringify(attr.value)};\n`
                    break
                case 'expr':
                    props += `    Object.defineProperty($props, ${JSON.stringify(attr.name)}, { get: () => (${attr.expr}), enumerable: true, configurable: true });\n`
                    break
                case 'event':
                    props += `    $props[${JSON.stringify(attr.name)}] = (...$args) => { const $fn = (${attr.expr}); return typeof $fn === "function" ? $fn(...$args) : undefined; };\n`
                    break
                case 'bind':
                    props += `    $props[${JSON.stringify(attr.name)}] = (${attr.expr});\n`
                    break
                case 'spread':
                    props += `    { const $sp = (${attr.expr}); if ($sp !== null && typeof $sp === "object") for (const $k of Object.keys($sp)) Object.defineProperty($props, $k, { get: () => (${attr.expr})[$k], enumerable: true, configurable: true }); }\n`
                    break
                case 'class':
                case 'style':
                    break
            }
        }
        let childrenFn = 'null'
        if (slot.meta.hasChildren) {
            const body = slot.meta.body
            if (body === undefined)
                throw new Error('component slot with children is missing its body')
            childrenFn = `() => (${this.mountable(body, '$scope')})`
        }
        props += `    $sink.push($rt.component(${parentOf(slot.path)}, ${this.openRef(slot, nav)}, ${nav(slot.path)}, ${JSON.stringify(name)}, ${componentRef(this.analysis, name)}, $props, ${childrenFn}, $scope));\n`
        props += '  }\n'
        return props
    }
}

function indent(code: string, spaces: number): string {
    const pad = ' '.repeat(spaces)
    return code
        .split('\n')
        .map((line) => (line === '' ? line : pad + line))
        .join('\n')
}

export function emitClientModule(plan: TemplatePlan, analysis: ScopeAnalysis): string {
    return new ClientEmitter(analysis).emit(plan)
}
