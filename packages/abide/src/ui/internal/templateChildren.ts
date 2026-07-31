// WHERE A `TemplateNode`'S CHILDREN ARE — one answer, as a table.
//
// Three walks needed this and each restated it: `analyzeBindings.walkNestedScripts` (finding branch-local
// `<script>`s), `templatePlan.collectComponentNames` (finding `{#component}` definitions), and
// `templateSemanticTokens.scriptBodies` (highlighting script bodies for the LSP). Nine near-identical
// `switch` arms apiece, over the same clause fields — `node.then`/`node.catch`/`node.finally`,
// `branches[].children`, `cases[].children`, `leading`.
//
// This is not a LOWERING, so ADR 0029's "each lane keeps its own walk" does not cover it — the ADR names
// this case as still in scope: a BINDING or STRUCTURAL fact about the AST, which no lane needs its own
// version of. The child-list shape is `ast.ts`'s.
//
// All three FAILED OPEN. None had a `default` arm, so a new node type — or a new clause on an existing
// block — was silently skipped by each, with three different silent consequences:
//
//   - `walkNestedScripts` misses it → `templatePlan.levelScript` finds no `NestedScript` → the
//     branch-local `<script>` emits NOTHING, its `state()`/`watch` vanish, and template references
//     resolve to `$scope.x === undefined`. No error, wrong render, both lanes.
//   - `collectComponentNames` misses it → `rejectComponentCall` never fires inside the new construct, so
//     the removed `{Name(…)}` lowering leaks back in.
//   - `scriptBodies` misses it → LSP highlighting stops inside the construct.
//
// Contrast `emitServer.inlinableChildren`, which walks the ServerChunk tree with the same shape and ends
// in `default: return false` — fail-CLOSED, so an unknown kind costs a microtask rather than correctness.
// A `Record` over the union is the compile-time version of that: a 16th `TemplateNode` member does not
// compile until it declares where its children are.
//
// The three walks agreed at the time this was written. That is what makes it worth doing now rather than
// after they stop agreeing — the same footing `SLOT_FOOTPRINT.ts` was justified on.

import type { TemplateNode } from './ast.ts'

// One child list, and whether it is its own LEVEL.
export interface TemplateChildList {
    nodes: TemplateNode[]
    // 'block' — a body that becomes its own level, so it can host a branch-local `<script>` whose
    // bindings resolve off that level's `$scope`.
    // 'inline' — children folded into the PARENT level (an element's or component's content, and the
    // whitespace gap between `{#switch}` and its first `{:case}`), which therefore cannot host one.
    site: 'block' | 'inline'
}

const NO_CHILDREN: readonly TemplateChildList[] = []

// Keyed by the node's own discriminant so each arm gets the narrowed node type — which is what makes a
// missing clause field a compile error rather than a silent omission.
type ChildListsByType = {
    [K in TemplateNode['type']]: (
        node: Extract<TemplateNode, { type: K }>,
    ) => readonly TemplateChildList[]
}

const CHILD_LISTS: ChildListsByType = {
    // Leaves: nothing nests inside them. `Script`/`Style` bodies are raw text, not template nodes.
    Text: () => NO_CHILDREN,
    Comment: () => NO_CHILDREN,
    Interpolation: () => NO_CHILDREN,
    Html: () => NO_CHILDREN,
    AwaitInterpolation: () => NO_CHILDREN,
    Script: () => NO_CHILDREN,
    Style: () => NO_CHILDREN,

    Element: (node) => [{ nodes: node.children, site: 'inline' }],
    Component: (node) => [{ nodes: node.children, site: 'inline' }],

    IfBlock: (node) => node.branches.map((branch) => ({ nodes: branch.children, site: 'block' })),
    ForBlock: (node) =>
        node.catch === null
            ? [{ nodes: node.children, site: 'block' }]
            : [
                  { nodes: node.children, site: 'block' },
                  { nodes: node.catch.children, site: 'block' },
              ],
    AwaitBlock: (node) => {
        const lists: TemplateChildList[] = [{ nodes: node.pending, site: 'block' }]
        if (node.then !== null) lists.push({ nodes: node.then.children, site: 'block' })
        if (node.catch !== null) lists.push({ nodes: node.catch.children, site: 'block' })
        if (node.finally !== null) lists.push({ nodes: node.finally.children, site: 'block' })
        return lists
    },
    SwitchBlock: (node) => {
        const lists: TemplateChildList[] = [{ nodes: node.leading, site: 'inline' }]
        for (const arm of node.cases) lists.push({ nodes: arm.children, site: 'block' })
        return lists
    },
    TryBlock: (node) => {
        const lists: TemplateChildList[] = [{ nodes: node.children, site: 'block' }]
        if (node.catch !== null) lists.push({ nodes: node.catch.children, site: 'block' })
        if (node.finally !== null) lists.push({ nodes: node.finally.children, site: 'block' })
        return lists
    },
    ComponentBlock: (node) => [{ nodes: node.children, site: 'block' }],
}

// Every child list this node owns, in source order. One cast, here, because an indexed access on a
// discriminated union cannot express "the arm for THIS node's own tag" generically — the table's type is
// what makes it sound.
export function childListsOf(node: TemplateNode): readonly TemplateChildList[] {
    const lists = CHILD_LISTS[node.type] as (n: TemplateNode) => readonly TemplateChildList[]
    return lists(node)
}

// WHERE A `TemplateNode` BINDS A NAME — the other half of the same structural fact, and the reason this
// table earns its place next to the one above rather than in `templatePlan`.
//
// A template-declared binding is PUBLISHED ON `$scope`, not lowered to a lexical `const`: a `{#for}` item,
// a `{:then}`/`{:catch}` param and an inline component's params all land on the level's scope object
// (`genComponentDef` writes `$s.children = $args[1]` and then binds the declared params over the same
// `$s`). That is what makes `children` a COLLISION rather than a shadow — the outlet resolves
// `$scope.children`, so `{#for children of list}<slot/>{/for}` asks the outlet to invoke the loop ITEM.
//
// It was reserved in `rewriteExpr` only, which sees expressions and therefore only ever caught a
// REFERENCE. The binding itself was taken verbatim (`item: node.item`), so the form the compiler spec
// names as the reason for the reservation was the one form that compiled — and then threw
// `<children> is not a component in scope` at RENDER, where nothing points at the binding that caused it.
//
// Same `Record`-over-the-union shape as `CHILD_LISTS`, for the same reason: a node type that starts
// binding a name does not compile until it says so here.
export interface TemplateBindingSite {
    // The raw binding text — possibly a destructuring pattern, so the reserved-name check tokenizes it
    // rather than comparing it.
    pattern: string
    // What to call it in a diagnostic, e.g. `{#for} item`.
    where: string
}

const NO_BINDINGS: readonly TemplateBindingSite[] = []

type BindingSitesByType = {
    [K in TemplateNode['type']]: (
        node: Extract<TemplateNode, { type: K }>,
    ) => readonly TemplateBindingSite[]
}

const BINDING_SITES: BindingSitesByType = {
    Text: () => NO_BINDINGS,
    Comment: () => NO_BINDINGS,
    Interpolation: () => NO_BINDINGS,
    Html: () => NO_BINDINGS,
    AwaitInterpolation: () => NO_BINDINGS,
    Script: () => NO_BINDINGS,
    Style: () => NO_BINDINGS,
    Element: () => NO_BINDINGS,
    Component: () => NO_BINDINGS,
    IfBlock: () => NO_BINDINGS,
    SwitchBlock: () => NO_BINDINGS,

    ForBlock: (node) => {
        const sites: TemplateBindingSite[] = [{ pattern: node.item, where: '{#for} item' }]
        if (node.index !== null) sites.push({ pattern: node.index, where: '{#for} index' })
        if (node.catch?.param != null)
            sites.push({ pattern: node.catch.param, where: '{:catch} param' })
        return sites
    },
    AwaitBlock: (node) => {
        const sites: TemplateBindingSite[] = []
        if (node.then?.param != null)
            sites.push({ pattern: node.then.param, where: '{:then} param' })
        if (node.catch?.param != null)
            sites.push({ pattern: node.catch.param, where: '{:catch} param' })
        return sites
    },
    TryBlock: (node) => {
        if (node.catch?.param == null) return NO_BINDINGS
        return [{ pattern: node.catch.param, where: '{:catch} param' }]
    },
    // The raw parameter list, unsplit: the check reads the whole text, so a reserved name is found
    // wherever in the list it sits without this table needing to know the list's grammar.
    ComponentBlock: (node) =>
        node.params.trim() === ''
            ? NO_BINDINGS
            : [{ pattern: node.params, where: `{#component ${node.name}} param` }],
}

// Every name this node binds onto the scope chain. Same cast, same reason, as `childListsOf`.
export function bindingSitesOf(node: TemplateNode): readonly TemplateBindingSite[] {
    const sites = BINDING_SITES[node.type] as (n: TemplateNode) => readonly TemplateBindingSite[]
    return sites(node)
}
