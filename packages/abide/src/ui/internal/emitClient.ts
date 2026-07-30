// `.abide` CLIENT MODULE EMITTER (Stage 1, PR3) — produces a browser-shippable ES-module string.
//
// Turns a `TemplatePlan` + `BindingAnalysis` into `import * as $rt from "abide/ui/internal/runtime"`,
// module-level `$rt.template(...)` skeletons, and `export function mount($target, $scope)` that clones
// each template, walks a cursor (firstChild/nextSibling steps from the plan's `path`) to every dynamic
// node, and wires the `$rt.*` helpers with real-identifier thunks. Block/component/component bodies are
// nested mount functions (so lexical `<script>` cells are captured) selected by clone id. Also emits
// `export function hydrate($container, $scope)` (Stage 2): the same build walk over a cursor seeded on
// the server DOM — claiming existing nodes with suppress-initial-write, localized mismatch recovery,
// and a whole-page fresh-`mount` fallback as last resort.
//
// No `new Function`, no `with`; script cells are lexical `let n = state(0)` with references rewritten to
// `()/.set()`, and free/block-bound template identifiers read off `$scope`.

import type { BindingAnalysis } from './analyzeBindings.ts'
import { reconstructImport } from './analyzeBindings.ts'
import { bindLazyPattern } from './bindLazyPattern.ts'
import { bindPattern } from './bindPattern.ts'
import { emitInstanceSetup, emitModuleEnsure } from './emitSetup.ts'
import { indent } from './indent.ts'
import { closeFinderFor, openIndexFor, SLOT_FOOTPRINT } from './SLOT_FOOTPRINT.ts'
import { splitParams } from './scanText.ts'
import type { ClientPlan, DynamicSlot, SlotKind, TemplatePlan } from './templatePlan.ts'

// One variant of the slot union, by kind — so each `gen*` declares the payload it actually reads and
// the compiler checks the planner supplied it.
type SlotOf<K extends SlotKind> = Extract<DynamicSlot, { kind: K }>

// Which kinds are leaves, which are bracketed, and which finder locates a bracketed close is
// `SLOT_FOOTPRINT` — one table, exhaustive over `SlotKind`. It used to be two `Set<string>`s plus a
// hand-written `=== 'html'` here, which got no exhaustiveness check: an 18th bracketed kind fell through
// to `'element'`, consumed one child position instead of two, and desynced the hydrate cursor silently.

// ---------------------------------------------------------------------------
// Emitter (collects sub-plans → clone ids → mount functions)
// ---------------------------------------------------------------------------

class ClientEmitter {
    private analysis: BindingAnalysis
    private planIds = new Map<ClientPlan, number>()
    private plans: { id: number; plan: ClientPlan }[] = []

    constructor(analysis: BindingAnalysis) {
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
            // The setup preamble runs inside an OPEN EFFECT SCOPE, so every `watch` a `<script>` creates
            // hands its disposer to this instance and dies with it — that is the whole unmount story
            // (§C4.5: no `onDestroy`; a `watch` teardown IS the cleanup hook). The scope closes before
            // `$mount0` so template wiring keeps owning its own effects through `$sink`, and the `finally`
            // makes a throwing preamble close it too rather than strand it open across the next mount.
            `\nexport function mount($target, $scope, $anchor) {\n` +
            `  const $setup = $rt.openEffectScope();\n` +
            `  try {\n` +
            indent(emitInstanceSetup(this.analysis), 2) +
            indent(fns, 4) +
            `    $rt.closeEffectScope($setup);\n` +
            `    const $dispose = $mount0($target, $anchor === undefined ? null : $anchor, $scope);\n` +
            `    return () => { $dispose(); $rt.disposeEffectScope($setup); };\n` +
            `  } finally {\n` +
            `    $rt.closeEffectScope($setup);\n` +
            `  }\n` +
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
            `\nexport default (props, childrenFn, $parent, $site) => ({ mount: ($p, $a) => {\n` +
            `  const $s = Object.create($parent ?? null);\n` +
            // Per-component-localized seed: open THIS instance's own bucket, keyed by its STABLE SITE (the
            // 4th arg, from the shared plan) rather than by mount order — so its `state()` calls replay from
            // a bucket isolated from siblings', and the key can't shift when an earlier sibling mounts
            // asynchronously (a `{#for await}` item) on one side but not the other.
            `  if ($parent && $parent.state && $parent.state.forSite) $s.state = $parent.state.forSite($site);\n` +
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
        // Component definitions first (hoisted).
        for (const slot of plan.slots) {
            if (slot.kind === 'componentDef') wiring += this.genComponentDef(slot)
        }
        for (const slot of plan.slots) {
            if (slot.kind === 'componentDef' || slot.kind === 'script') continue
            wiring += this.genSlot(slot, nav, parentOf)
        }

        // The branch-local `<script>` (C9.4), if this level owns one. It runs BEFORE the structural walk
        // and before every other slot: it is this level's setup, and the wiring below reads what it
        // publishes on `$scope`.
        let setup = ''
        for (const slot of plan.slots) {
            if (slot.kind === 'script') setup += this.genNestedScript(slot)
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
            setup +
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
            if (slot.kind === 'componentDef' || slot.path.length <= depth) continue
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
            // Bracketed entries only: which finder locates the close anchor from the open one.
            closeFinder?: string
        }
        const entries: Entry[] = []
        for (const [index, bucket] of groups) {
            const here = bucket.filter((s) => s.path.length === depth + 1)
            // A bracketed slot wins over a leaf at the same index: it claims two positions and the leaf
            // test would claim one. Asking the table in this order keeps that precedence where the old
            // if/else-if chain had it.
            const bracketed = here.find((s) => closeFinderFor(s.kind) !== undefined)
            if (bracketed !== undefined) {
                const closeFinder = closeFinderFor(bracketed.kind)
                if (closeFinder === undefined)
                    throw new Error(`unreachable: ${bracketed.kind} lost its close finder`)
                entries.push({
                    start: openIndexFor(bracketed.kind, index),
                    index,
                    kind: 'block',
                    closeFinder,
                })
                continue
            }
            const leafSlot = here.find((s) => SLOT_FOOTPRINT[s.kind].positions === 1)
            if (leafSlot !== undefined) entries.push({ start: index, index, kind: 'leaf' })
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
                // Every leaf (`interpolation`/`await`) is a single scalar text position. A component never
                // lands here — it is invoked as a tag, which is a block-anchored component slot — and
                // `{html(...)}` is bracketed by its own anchors, so both are handled below.
                code += `${varName} = $rt.hydrateValueLeaf();\n`
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
                // `entry.start` IS the open index — `openIndexFor` already derived it above, so this
                // does not restate the `- 1`.
                const openVar = `$n${[...prefix, entry.start].join('_')}`
                const closeVar = `$n${[...prefix, entry.index].join('_')}`
                code += `${openVar} = $rt.hydrateNode();\n`
                code += `${closeVar} = $rt.${entry.closeFinder}(${openVar});\n`
                code += `$rt.hydrateSeek(${closeVar} !== null ? $rt.nextSibling(${closeVar}) : null);\n`
                expected = entry.index + 1
            }
        }
        return code
    }

    // The OPEN `<!--[-->` anchor variable for a block/component slot (its close anchor is `slot.path`).
    private openRef(path: number[], nav: (p: number[]) => string): string {
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

    // A branch-local `<script>` (C9.4): the level takes a `$scope` of its OWN, the setup publishes its
    // bindings there (so every level nested inside inherits them and no sibling branch does), and the
    // whole preamble runs inside an effect scope this level owns. Disposing that scope on unmount is
    // what makes a `watch` in a branch script a real per-branch/per-iteration lifecycle hook — the same
    // contract the root script gets from `mount`, one level down.
    private genNestedScript(slot: SlotOf<'script'>): string {
        return (
            `  $scope = Object.create($scope);\n` +
            `  const $branch = $rt.openEffectScope();\n` +
            `  try {\n${indent(slot.setup, 4)}  } finally {\n` +
            `    $rt.closeEffectScope($branch);\n` +
            `  }\n` +
            `  $sink.push(() => $rt.disposeEffectScope($branch));\n`
        )
    }

    private genComponentDef(slot: SlotOf<'componentDef'>): string {
        const patterns = slot.params.trim() === '' ? [] : splitParams(slot.params)
        // LAZY, not a copy: `$args[0]` is the caller's props object, whose every key is a getter over
        // the caller's scope. Copying the values out here reads each getter once, under the `untrack`
        // that wraps the factory call — so the body would render a snapshot and never re-read it. See
        // `bindLazyPattern`.
        let binds = ''
        for (const [i, pattern] of patterns.entries())
            binds += `    ${bindLazyPattern('$s', pattern, `$args[${i}]`)}\n`
        const bodyId = this.idFor(slot.body)
        return (
            `  $scope[${JSON.stringify(slot.name)}] = (...$args) => ({ mount: ($p, $a) => {\n` +
            `    const $s = Object.create($scope);\n` +
            // The component-invocation convention passes the caller's children factory as the 2nd arg,
            // so `<slot/>` (which resolves `$scope.children`) is filled automatically — a component need
            // not declare a `children` param. An explicit param of the same name overrides it below.
            `    if (typeof $args[1] === "function") $s.children = $args[1];\n` +
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
        switch (slot.kind) {
            case 'interpolation':
                return `  $sink.push($rt.interpolate(${parentOf(slot.path)}, ${nav(slot.path)}, () => (${slot.expr}), ${slot.prefixLen}));\n`
            case 'html':
                return `  $sink.push($rt.htmlBlock(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, () => (${slot.expr})));\n`
            case 'await':
                return `  $sink.push($rt.awaitText(${parentOf(slot.path)}, ${nav(slot.path)}, () => (${slot.expr}), ${slot.prefixLen}));\n`
            case 'attr':
                return `  $sink.push($rt.setAttr(${nav(slot.path)}, ${JSON.stringify(slot.name)}, () => (${slot.expr})));\n`
            case 'event':
                return `  $sink.push($rt.listen(${nav(slot.path)}, ${JSON.stringify(slot.event)}, () => (${slot.expr})));\n`
            case 'class':
                return `  $sink.push($rt.toggleClass(${nav(slot.path)}, ${JSON.stringify(slot.name)}, () => (${slot.expr})));\n`
            case 'style':
                return `  $sink.push($rt.setStyleProp(${nav(slot.path)}, ${JSON.stringify(slot.name)}, () => (${slot.expr})));\n`
            case 'spread':
                return `  $sink.push($rt.spread(${nav(slot.path)}, () => (${slot.expr})));\n`
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

    private genBind(slot: SlotOf<'bind'>, nav: (p: number[]) => string): string {
        const el = nav(slot.path)
        const { name, expr } = slot
        if (name === 'element') {
            return `  { const $d = $rt.bindElement(${el}, (${expr})); if ($d !== undefined) $sink.push($d); }\n`
        }
        let helper = 'bindValue'
        if (name === 'group') helper = 'bindGroup'
        else if (name === 'checked') helper = 'bindChecked'
        return `  { const $acc = $rt.boundAccessor((${expr})); if ($acc !== null) $sink.push($rt.${helper}(${el}, $acc)); }\n`
    }

    private genIf(
        slot: SlotOf<'if'>,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const branches = slot.branches
            .map((b) => {
                const condition = b.expr === null ? 'null' : `() => (${b.expr})`
                return `{ condition: ${condition}, body: ${this.blockFn(b.plan, '$scope')} }`
            })
            .join(', ')
        return `  $sink.push($rt.ifBlock(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, [${branches}]));\n`
    }

    private genSwitch(
        slot: SlotOf<'switch'>,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const cases = slot.branches
            .map((c) => {
                const test = c.expr === null ? 'null' : `() => (${c.expr})`
                return `{ test: ${test}, body: ${this.blockFn(c.plan, '$scope')} }`
            })
            .join(', ')
        const leading = this.blockFn(slot.leading, '$scope')
        return `  $sink.push($rt.switchBlock(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, () => (${slot.discriminant}), ${leading}, [${cases}]));\n`
    }

    private genFor(
        slot: SlotOf<'for'>,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const { item, index, key } = slot
        const bodyId = this.idFor(slot.body)

        let keyFor: string
        if (key === null) {
            keyFor = '($value, $index) => $index'
        } else {
            let bindItem = `    ${bindPattern('$k', item, '$value')}\n`
            if (index !== null) bindItem += `    $k[${JSON.stringify(index)}] = $index;\n`
            // Rebind `$scope` to the temp item scope so the rewritten key expression resolves item/index.
            keyFor = `($value, $index) => {\n    const $k = Object.create($scope);\n${bindItem}    return (($scope) => (${key}))($k);\n  }`
        }

        // Each backing cell is emitted ONLY where something reads it. `$itemState` is read by the item
        // binding's getters and `$indexState` by the index getter, which exists only when the block
        // declares an index. Emitting them unconditionally allocated a live reactive cell per ITEM at
        // mount and wrote it per item on every reconcile — for `{#for n of items by n}`, pure waste.
        //
        // A destructured item used to skip the cell and re-assign the extracted names from `$v` on every
        // `update` instead. Those were plain property writes, which notify nobody: the body had already
        // subscribed to `$child.t`, so a reconcile that handed the row a new object left it rendering the
        // old one. Both shapes now read through the one cell.
        let createItem = '($p, $end, $value, $index) => {\n'
        createItem += '    const $itemState = $rt.state($value);\n'
        if (index !== null) createItem += '    const $indexState = $rt.state($index);\n'
        createItem += '    const $child = Object.create($scope);\n'
        // Anything in the loop body that owns state gets a DISTINCT seed bucket per iteration — a
        // component, or a branch-local `<script>` (see emitServer's `for`). Only emitted when the body
        // has one: this allocates per item.
        if (slot.hasComponent || slot.hasScript)
            createItem +=
                '    if ($scope.state && $scope.state.forItem) $child.state = $scope.state.forItem($index);\n'
        createItem += `    ${bindLazyPattern('$child', item, '$itemState()')}\n`
        if (index !== null) {
            createItem += `    Object.defineProperty($child, ${JSON.stringify(index)}, { get: () => $indexState(), configurable: true });\n`
        }
        createItem += `    const $dispose = $rt.untrack(() => $mount${bodyId}($p, $end, $child));\n`
        createItem += '    return {\n'
        createItem += '      update: ($v, $i) => {'
        createItem += ' $itemState.set($v);'
        if (index !== null) createItem += ' $indexState.set($i);'
        createItem += ' },\n'
        createItem += '      dispose: () => $dispose(),\n'
        createItem += '    };\n  }'

        let catchFn = 'null'
        if (slot.catch !== null) {
            const c = slot.catch
            const child = c.param
                ? `(() => { const $c = Object.create($scope); ${bindPattern('$c', c.param, '$error')} return $c; })()`
                : '$scope'
            catchFn = `($error) => ${this.blockFn(c.plan, child)}`
        }

        return (
            `  $sink.push($rt.forBlock(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, {\n` +
            `    read: () => (${slot.iterable}),\n` +
            `    isAwait: ${slot.await ? 'true' : 'false'},\n` +
            `    keyFor: ${keyFor},\n` +
            `    createItem: ${createItem},\n` +
            `    catch: ${catchFn},\n` +
            `  }));\n`
        )
    }

    private genAwaitBlock(
        slot: SlotOf<'awaitBlock'>,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const pending = this.blockFn(slot.pending, '$scope')
        const thenClause = slot.then
        const thenFn = thenClause
            ? `($value) => ${this.paramBlockFn(thenClause.plan, thenClause.param, '$value')}`
            : 'null'
        const catchFn = slot.catch
            ? `($error) => ${this.paramBlockFn(slot.catch.plan, slot.catch.param, '$error')}`
            : 'null'
        const finallyFn = slot.finally ? this.blockFn(slot.finally, '$scope') : 'null'
        return (
            `  $sink.push($rt.awaitBlock(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, () => (${slot.expr}), {\n` +
            `    pending: ${pending},\n` +
            `    then: ${thenFn},\n` +
            `    catch: ${catchFn},\n` +
            `    finally: ${finallyFn},\n` +
            `  }));\n`
        )
    }

    private genTry(
        slot: SlotOf<'try'>,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const body = this.blockFn(slot.body, '$scope')
        const catchFn = slot.catch
            ? `($error) => ${this.paramBlockFn(slot.catch.plan, slot.catch.param, '$error')}`
            : 'null'
        const finallyFn = slot.finally ? this.blockFn(slot.finally, '$scope') : 'null'
        return `  $sink.push($rt.tryBlock(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, ${body}, ${catchFn}, ${finallyFn}));\n`
    }

    // A BlockFn whose scope carries an optional single param binding.
    private paramBlockFn(plan: ClientPlan, param: string | null, valueExpr: string): string {
        if (param === null || param.trim() === '') return this.blockFn(plan, '$scope')
        const child = `(() => { const $c = Object.create($scope); ${bindPattern('$c', param, valueExpr)} return $c; })()`
        return this.blockFn(plan, child)
    }

    private genComponent(
        slot: SlotOf<'component'>,
        nav: (p: number[]) => string,
        parentOf: (p: number[]) => string,
    ): string {
        const name = slot.name
        let props = '  {\n    const $props = {};\n'
        for (const attr of slot.attrs) {
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
        // A childless site passes the SHARED empty factory, not `null` — see `runtime.emptyChildren` for
        // why the distinction is load-bearing (`<slot/>` invokes whatever is passed here) and what the
        // `null` broke. The server has always spelled it this way (`emitServer.genComponent`).
        let childrenFn = '$rt.emptyChildren'
        if (slot.hasChildren) childrenFn = `() => (${this.mountable(slot.body, '$scope')})`
        // A cell- or memo-named tag (`<C/>` where `const C = memo(() => …)`) is a REACTIVE component:
        // read it in an effect and re-mount on identity change. Otherwise resolve the component once.
        // Both the reactive flag and the reference itself come from the plan — `templatePlan` is the
        // only place that knows this tag's LEVEL, and a branch-local `<script>`'s bindings live on
        // `$scope` rather than lexically.
        const { ref, siteId } = slot
        if (slot.reactive) {
            props += `    $sink.push($rt.dynamicComponent(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, ${JSON.stringify(name)}, () => (${ref}), $props, ${childrenFn}, $scope, ${siteId}));\n`
        } else {
            props += `    $sink.push($rt.component(${parentOf(slot.path)}, ${this.openRef(slot.path, nav)}, ${nav(slot.path)}, ${JSON.stringify(name)}, ${ref}, $props, ${childrenFn}, $scope, ${siteId}));\n`
        }
        props += '  }\n'
        return props
    }
}

export function emitClientModule(plan: TemplatePlan, analysis: BindingAnalysis): string {
    return new ClientEmitter(analysis).emit(plan)
}
