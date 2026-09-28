import { RAW_CLOSE, RAW_OPEN } from '#shared/RAW_RUN.ts'
import {
    REGION_CAUGHT,
    REGION_CLOSE,
    REGION_OPEN,
    ROW_OPEN,
} from '#ui/REGION.ts'
import { CHILDREN } from './CHILDREN.ts'
import {
    Cursor,
    type Position,
    placeTemplate,
    REGION_ROOT,
    ROW_ROOT,
} from './Cursor.ts'
import type { Read } from './classifyRead.ts'
import { bindingsOf, isSingleRooted, isSlot } from './classifyTemplate.ts'
import { decodeCharacterReferences } from './decodeCharacterReferences.ts'
import {
    emitHead,
    emitRow,
    importClause,
    mergedValue,
    renderMarkup,
    shareScope,
    staticAttributeBytes,
    unlandable,
    type ValueRender,
    type WrittenAttribute,
    writtenAttributes,
} from './emitComponent.ts'
import { invocationProps } from './invocationProps.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import { Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import { SHARED_NAMES } from './SHARED_NAMES.ts'
import { RUNTIME_SPECIFIER, SHARED_SPECIFIER } from './SPECIFIERS.ts'
import { componentImports, splitImports, withoutProps } from './splitImports.ts'
import type { Attribute, Setup, TemplateNode } from './TemplateNode.ts'

// The client half of one `.abide`. WHERE A NODE STANDS IS DECIDED ONCE, by `placeTemplate`, and the
// server's markup is rendered from the same positions this module walks, builds and fills from. So
// the position the server wrote to and the position this module walks to are one answer, rather
// than two walks held in agreement by the predicates they share.
//
// NOTHING IS ADDED TO THE DOCUMENT to make this work. Each node is found from the one before it or
// the one it stands in, which is exact for a region whose shape is static — and a compiled
// template's is, up to the boundaries where 32.12, 32.13 and 32.15 make it depend on a value.
// Those boundaries are where a marker earns its place, and the walk steps over each from its
// closing anchor; nowhere before them does a marker earn anything.
//
// 41.6 — hydration re-executes the setup, so the values the client starts from are the values the
// document was rendered with.

// What the emitters thread through every region: the next region's number.
type Counter = { next: number }

// The next region's name under `prefix`.
function claim(counter: Counter, prefix: string): string {
    const name = `${prefix}${counter.next}`
    counter.next += 1
    return name
}

// `selfFill` is how this module can be mounted against an EMPTY region: a file a ROUTE reaches
// (30.11) is mounted against a page no server painted, once a navigation; a file another INVOKES
// as a component (32.18) can stand in a row a list grew by, once A ROW. Both need a second copy of
// the template, and one that needs neither is 34% more client than it needs: measured at 1797 ->
// 2405 shipped lines over the corpus with every file carrying one. INVOKED decides whether that
// copy is markup or a build (`Cursor.repeated`) — a page's fill is one parse, and a component's is
// a parse per row — and ROUTED decides whether it carries a head (39.6). A file can be both, and
// then each fact decides its own half.
//
// WHICH FILES THOSE ARE IS THE BUILD'S KNOWLEDGE, being a fact about the import graph and the file
// tree rather than about this file, so it arrives rather than being guessed here — and it DEFAULTS
// TO NEITHER, because the wrong answer costs a static page the "ships no runtime" fact above.
export type SelfFill = 'none' | 'routed' | 'invoked' | 'both'

// The mount's third argument, which only the router passes (`Router.mountFrom`).
const ROUTED = '__routed'

export function emitClient(
    file: AbideFile,
    reads: readonly Read[] = [],
    selfFill: SelfFill = 'none',
    // Where each `.abide` this file imports landed in the build (`componentGraph`).
    components: ReadonlyMap<string, string> = new Map(),
): string {
    const carriesOwnMarkup = selfFill !== 'none'
    const lowering = new Lowering(file, reads)
    const used = lowering.used
    // THE TEMPLATE IS PLACED ONCE (`placeTemplate`) and everything this module emits is rendered
    // from what was placed: the mount's walk, a region's build, and the markup a region made once
    // fills from — the same positions the server's markup is rendered from.
    const page = new Cursor(
        undefined,
        undefined,
        false,
        selfFill === 'invoked' || selfFill === 'both',
    )
    placeTemplate(file.template, page)
    const counter = { next: 0 }
    const { chain, helpers, lines } = emitRegion(page, lowering, counter)

    // 34.2 — A `<script module>` IS PROCESS-WIDE IN A BROWSER, which is MODULE SCOPE: it is
    // evaluated once when this module is first imported rather than once per `mount`, so a second
    // mount of the same page reads what the first one left.
    const moduleSetup = splitImports(lowering.modules())
    const setup = splitImports(lowering.scripts())
    // 32.18 — A COMPONENT FILLS ITS OWN REGION where the server wrote none. A row the list grew by
    // is built in the browser, and the child's markup is in the child's SERVER module — which the
    // browser may not reach. So the caller writes the anchor pair alone and the child fills it
    // from the template this module already holds, once, inside the instance whose setup just ran.
    // Rendering it from the caller instead would mean the child's setup running twice per row: one
    // run for the markup and another for the bindings.
    //
    // 39.6 — A ROUTE LEVEL APPLIES ITS OWN HEAD THERE, for the same reason: an empty region is
    // one no server painted, so no server wrote this level's head either. Inside `mount`, after
    // the setup, because a `<title>{title}</title>` reads the instance's names as a body slot does
    // — at module scope it was a ReferenceError on every navigation to it. Before the fill, so the
    // title the reader sees is the page they are arriving at for however long the build takes;
    // and a layout mounts before the page in its slot, so the deepest contribution lands last and
    // wins (39.4). A region the server painted is hydrated with the head the server wrote.
    //
    // ONLY WHERE THE ROUTER MOUNTED IT, which it says with `ROUTED`: the server writes the heads of
    // the route's chain alone, and an invoked component fills an empty region once per row the list
    // grew by — applying a head there is a parse and a walk of `document.head` a row. So a file that
    // is both routed and invoked titles the document as a page and leaves it alone as a row.
    const headMarkup =
        selfFill === 'routed' || selfFill === 'both'
            ? emitHead(file, lowering, true)
            : "''"
    const heads = headMarkup !== "''"
    const applied = heads
        ? `if (${ROUTED}) ${lowering.use('applyHead')}(${headMarkup}); `
        : ''
    const builds = carriesOwnMarkup && page.positions.length > 0
    let fills = ''
    if (applied !== '' || builds) {
        const build = builds
            ? `function __build(__document) {\n    ${emitMaker(page, lowering)}\n}\n`
            : ''
        const isEmpty = lowering.use('isEmptyRegion')
        const fill = builds
            ? `${lowering.use('fillRegion')}(${REGION_ROOT}, __build)`
            : ''
        fills = `${build}if (${isEmpty}(${REGION_ROOT})) { ${applied}${fill} }\n`
    }

    // NOTHING LIVE IS NO MODULE: every unit the page's region pushes is a binding, a listener or a
    // region, so an empty `lines` is a page with nothing live anywhere in it.
    // A blank run is only walked because something AFTER it is found through it, so with no
    // binding, no listener and no region anywhere in the page there is nothing to walk to.
    //
    // A FILL IS SOMETHING TO DO, which is why this asks `fills` rather than `lines` alone.
    // An INVOKED component with no binding in it still owns the markup for a row the browser grew
    // — the caller writes the anchor pair and nothing else (32.18) — so without its module every
    // browser-grown row of a static child would be empty.
    //
    // A FILE MOUNTED AGAINST AN EMPTY REGION SHIPS A MODULE REGARDLESS: the router or the caller's
    // client module imports it by name, so the no-op is what it ships.
    const live = lines.length > 0
    if (!live && fills === '')
        return carriesOwnMarkup ? 'export default () => {}\n' : ''

    // A SCOPE IS WHAT THERE IS TO STOP, so a module with nothing live opens none. A static child
    // still ships a module — it fills the anchors of a row the browser grew — and making it
    // allocate a `Scope`, its `stops` array and an entry in the caller's `children` per row is
    // three allocations a row for a mount whose body is empty. `Scope.own(undefined)` already
    // reads a mount that returns nothing, which is the same answer the no-op module gives.
    //
    // 41.10 — THE PAGE IS THE ONE REGION THAT CANNOT REBUILD, so it is the one that has to survive
    // a refusal binding by binding. Every other region answers a mismatch by re-rendering itself
    // from its own markup (`mountFunction`); the page has no block around it and rebuilding it
    // would throw away the document the server sent, focus, scroll and all, which is exactly what
    // the clause forbids.
    //
    // ONE `try` AROUND ALL OF THEM WAS THE SAME FAILURE `Mismatch` WAS WRITTEN AGAINST: it traded
    // the throw for a warning and still skipped every binding and listener after the one that
    // refused, so a page whose first slot disagreed was served looking right and completely dead
    // below that point. Guarded per unit, what is lost is the unit that actually disagreed.
    //
    // A UNIT IS WHAT EACH EMITTER PUSHES — an anchor, an address and its binding, a listener, a
    // bound attribute, a whole block or list — and it is independent by construction: every name a
    // unit declares is read inside it, the anchors excepted, and those are declared above. The
    // wrapper is the SAME BYTES every time, which is what makes the repetition nearly free once
    // gzipped, where a `guard(() => …)` helper would be a closure allocated per binding at mount.
    const guard = (unit: string): string =>
        `try {\n${unit}\n} catch (thrown) { if (!${lowering.use('warnMismatch')}(thrown)) throw thrown }`

    // THE WALK STANDS OUTSIDE EVERY GUARD, which is why it cannot throw (see `emitRegion`): it runs
    // once, top to bottom, after `fills` has put the page in place, and each unit then checks the
    // one node it was handed.
    const bindings = live
        ? `const ${SCOPE} = new ${lowering.use('Scope')}()
${chain.map((line) => `${line}\n`).join('')}\
${lines.map(guard).join('\n')}
return ${SCOPE}`
        : ''

    // 10.5 on the other side, and the same scope: the child's `mount` is called from inside the
    // parent's, so the chain a key is looked up is the component tree here too.
    // 10.5 — CAPTURED WHERE A DEFERRED MOUNT CAN NEED IT. A row or an arm mounted after the fact
    // runs from a `watch` effect, with nothing on the stack; this is the scope it resumes.
    const captured = page.holdsComponent
        ? `const ${SHARE_AT} = ${lowering.use('currentShare')}()\n`
        : ''
    const { opened, closed } = shareScope(lowering, '')
    // The escaping is an APP's (`abide`); everything else is the client runtime's (`abide/runtime`).
    const shared: string[] = []
    const runtime: string[] = []
    for (const name of used)
        (SHARED_NAMES.has(name) ? shared : runtime).push(name)

    const sharedImport =
        shared.length === 0
            ? ''
            : `import { ${importClause(shared.sort())} } from '${SHARED_SPECIFIER}'\n`
    // THE SETUP IS NOT RE-INDENTED. Adding a margin to every line rewrites the INSIDE of a
    // multi-line template literal, so a string constant gains four spaces it never had.
    return `${sharedImport}import { ${importClause(runtime.sort())} } from '${RUNTIME_SPECIFIER}'
${componentImports(withoutProps(moduleSetup.imports), '.client', components)}${componentImports(withoutProps(setup.imports), '.client', components)}
${moduleSetup.body === '' ? '' : `${moduleSetup.body}\n`}\
export default function mount(${REGION_ROOT}${heads ? `, ${PROPS} = {}, ${ROUTED}` : lowering.takesProps() ? `, ${PROPS} = {}` : ''}) {
${opened}${setup.body}
${helpers.join('\n')}
${fills}${captured}${bindings}${closed}
}
`
}

// One region's bindings, emitted against its own root: the page, a `{#if}` arm, a `{#for}` row, a
// `<slot/>` fallback or a caller's children. Each is a sink of its own (`Cursor`), so `__c1` in one
// and `__c1` in another are different nodes and neither region can reach the other's.
//
// TWO KINDS OF LINE, and the split is 41.10's. The WALK — one `const` per position it needs, each
// found from the one before it — goes into `chain` and NEVER THROWS: an absent node is carried
// forward as `undefined`. The UNITS go into `lines`, and each CHECKS the node it was handed
// (`elementHere`, `textHere`, `regionFound`). On a page, where every unit is guarded apart, a node
// that disagrees then loses the unit that needed it and nothing after it — the locality a path
// re-walked from the root used to buy, without re-walking.
//
// THE WALK IS PRUNED. A position is walked when something at or after it in its parent needs it —
// a binding, or a later position found through it — so a static subtree and a static tail are
// never visited. A blank run standing before something walked is put back as the walk passes
// (`runHere`), because what follows it is found from it.
function emitRegion(
    sink: Cursor,
    lowering: Lowering,
    counter: Counter,
): RegionEmitted {
    const chain: string[] = []
    const helpers: string[] = []
    const lines: string[] = []
    const positions = sink.positions
    // What each element binds, decided once and read by both passes below.
    const bound = new Map<Position, ReturnType<typeof bindingsOf>>()
    const live = new Set<Position>()
    for (const at of positions) {
        if (at.kind === 'region') {
            live.add(at)
            continue
        }
        if (at.kind === 'text') {
            if (isLiveRun(at.run, lowering)) live.add(at)
            continue
        }
        const bindings = bindingsOf(at.holder as ElementNode)
        // ONLY WHERE THE EXPRESSION IS LIVE, which is `isLiveRun`'s rule asked of one attribute:
        // `data-kind={kind}` over a plain `const` is written once by the server and never moves,
        // and a binding for it is a reader woken on every page for nothing.
        bindings.attributes = bindings.attributes.filter((one) =>
            lowering.isLive(one.attribute),
        )
        if (
            bindings.handlers.length === 0 &&
            bindings.attributes.length === 0 &&
            bindings.elements.length === 0 &&
            bindings.binds.length === 0 &&
            bindings.spreads.length === 0
        )
            continue
        bound.set(at, bindings)
        live.add(at)
    }

    // BACKWARDS, so everything after a position — its later siblings and its own descendants — is
    // decided before it is. `followed` holds the frames, keyed by the element they stand inside,
    // that have a walked position later than the one being decided.
    const walked = new Set<Position>()
    const followed = new Set<Position | null>()
    for (let index = positions.length - 1; index >= 0; index -= 1) {
        const at = positions[index] as Position
        if (!live.has(at) && !followed.has(at) && !followed.has(at.within))
            continue
        walked.add(at)
        followed.add(at.within)
    }

    for (const at of positions) {
        if (!walked.has(at)) continue
        if (at.kind === 'region')
            chain.push(
                `const ${at.name} = ${lowering.use('regionHere')}(${at.from})`,
            )
        // A RUN THAT CAN HOLD MARKUP (32.27) is stepped over to its closing anchor where it does,
        // and a blank one is put back where it rendered nothing — the same step (`runHere`). A run
        // of proven parts is text for good and is its node as found.
        else if (
            at.kind === 'text' &&
            (at.blank || lowering.holdsMarkup(at.run))
        )
            chain.push(
                `const ${at.name} = ${lowering.use('runHere')}(${at.from}, ${at.blank ? at.parent : 'null'})`,
            )
        else chain.push(`const ${at.name} = ${at.from}`)
    }

    // THE UNITS, in the order a page always installed them — text, listeners, attributes, the node
    // handed over, then the regions. The walk does not depend on it; a `bind:element` callback has
    // always run with every other binding already in place, and that is kept.
    const texts: string[] = []
    const handlers: string[] = []
    const attributes: string[] = []
    const elements: string[] = []
    const regions: Position[] = []
    for (const at of positions) {
        if (!live.has(at)) continue
        if (at.kind === 'region') {
            regions.push(at)
            continue
        }
        const slot = at.name.slice('__c'.length)
        if (at.kind === 'text') {
            const values: string[] = []
            const brands: string[] = []
            const text: string[] = []
            const markup: string[] = []
            for (let piece = 0; piece < at.run.length; piece += 1) {
                const node = at.run[piece] as TemplateNode
                if (node.kind === 'text') {
                    markup.push(JSON.stringify(node.text))
                    // 32.28 — static text is markup, and `data` is not a parse: a piece with an
                    // entity in it goes in as the characters it stands for, decoded by the build.
                    text.push(
                        JSON.stringify(
                            decodeCharacterReferences(node.text, 'text'),
                        ),
                    )
                    continue
                }
                const value = `__v${slot}_${piece}`
                values.push(`${value} = ${lowering.slot(node)}`)
                brands.push(`${lowering.use('isRaw')}(${value})`)
                text.push(`${lowering.use('escapeless')}(${value})`)
                markup.push(`${lowering.use('escapeText')}(${value})`)
            }
            // RESOLVED ONCE, and the binding closes over what it resolved to. The node a position
            // lands on is the same one on every run while the run holds text — the walk put a blank
            // run's back and `setText` never removes it — so re-finding it per write is the same
            // answer bought again: measured in Chromium at 0.47 µs a write against 0.22 µs with the
            // node held. 32.27 is the one write that changes it: a `Raw` part turns the run into an
            // anchored one (`setMarkup`) and a later text value turns it back, so each write hands
            // back what the run now is and the binding holds that.
            texts.push(
                `let __t${slot} = ${lowering.use('textHere')}(${at.name})
${SCOPE}.watch(() => {
    const ${values.join(', ')}
    __t${slot} = ${brands.join(' || ')} ? ${lowering.use('setMarkup')}(__t${slot}, ${markup.join(' + ')}) : ${lowering.use('setText')}(__t${slot}, ${text.join(' + ')})
})`,
            )
            continue
        }
        const bindings = bound.get(at) as ReturnType<typeof bindingsOf>
        const element = `${lowering.use('elementHere')}(${at.name}, ${JSON.stringify(at.tag)})`
        for (const handler of bindings.handlers)
            handlers.push(
                `${element}.addEventListener(${JSON.stringify(handler.event)}, ${lowering.expression(handler.attribute)})`,
            )
        // 32.3 — THE ATTRIBUTE BINDING. The server wrote the value standing at render; this is
        // what keeps writing it. ONCE PER ELEMENT, NOT PER ATTRIBUTE: `<a href={u} title={t}>` is
        // one element and two bindings, and a refusal loses exactly what it should either way,
        // because every binding in the group needs the element the check refused.
        if (bindings.attributes.length > 0) {
            const writes: string[] = []
            for (const one of bindings.attributes) {
                // 32.21 IS THE INTERPOLATION'S CLAUSE ON THIS SIDE TOO, and 32.38's absence with it:
                // `setAttribute` answers through `attributeText`, as the server's markup did, so a
                // `javascript:` the server refused is refused the moment the value moves too.
                // A WATCH PER ATTRIBUTE, not one over the group: two attributes reading two
                // different values would otherwise each wake for the other's write.
                writes.push(
                    `${SCOPE}.watch(() => ${lowering.use(WRITES[one.write])}(__a${slot}, ${JSON.stringify(one.name)}, ${lowering.slot(one.attribute)}))`,
                )
            }
            attributes.push(
                `const __a${slot} = ${element}\n${writes.join('\n')}`,
            )
        }
        // 32.5, 32.7, 32.8 — THE PROPERTY AND THE VALUE, IN STEP BOTH WAYS: a watch on this region's
        // scope writes the property, and a listener writes it back.
        for (const bind of bindings.binds)
            attributes.push(
                `${lowering.use('bindProperty')}(${element}, ${JSON.stringify(bind.kind)}, ${lowering.reference(bind.attribute)}, ${SCOPE})`,
            )
        // 32.11 — THE SPREAD, KEPT WRITTEN: an attribute it stops carrying is removed.
        for (const spread of bindings.spreads)
            attributes.push(
                `${lowering.use('bindSpread')}(${element}, () => (${lowering.expression(spread.attribute)}), ${JSON.stringify(spread.explicit)}, ${SCOPE})`,
            )
        // 32.9 — THE NODE, HANDED OVER, once. Not a watch: what the value takes is the element,
        // which is the same node on every run a watch would have made — and the callback form's
        // `Disposer` goes on this region's scope, so a widget it set up is torn down when the
        // nodes it was set up over leave.
        for (const attribute of bindings.elements)
            elements.push(
                `const __r${slot} = ${lowering.use('bindElement')}(${element}, ${lowering.reference(attribute)})
if (__r${slot} !== undefined) ${SCOPE}.stops.push(__r${slot})`,
            )
    }
    for (const unit of texts) lines.push(unit)
    for (const unit of handlers) lines.push(unit)
    for (const unit of attributes) lines.push(unit)
    for (const unit of elements) lines.push(unit)

    for (const at of regions) {
        const holder = at.holder
        if (holder.kind === 'block') {
            if (holder.block === 'for')
                emitList(at, holder, lowering, lines, helpers, counter)
            else if (holder.block === 'try')
                emitTry(at, holder, lowering, lines, helpers, counter)
            else emitBlock(at, holder, lowering, lines, helpers, counter)
        } else if (holder.kind === 'element') {
            if (isSlot(holder)) emitSlot(at, lowering, lines, helpers, counter)
            else emitInvocation(at, holder, lowering, lines, helpers, counter)
        }
    }
    return { chain, helpers, lines }
}

type RegionEmitted = { chain: string[]; helpers: string[]; lines: string[] }

type ElementNode = Extract<TemplateNode, { kind: 'element' }>

// A region's bindings go through its SCOPE, so what replaced the region can stop them (see
// `Scope`). In the framework's own `__` namespace because a row binds the AUTHOR's item name as a
// parameter in the same scope.
const SCOPE = '__scope'

// Which runtime write each kind of `AttributeBinding` is handed to. A record rather than a chain
// of ternaries, so a fourth kind is a row here and the call site stays one line — all three take
// the same three arguments, which is what makes them one site at all.
const WRITES = {
    attribute: 'setAttribute',
    class: 'setClass',
    style: 'setStyleProperty',
} as const

// The share scope an instance captures for its deferred mounts (10.5), named apart from the one an
// instance OPENS (`shareScope`): a page that shares nothing still carries this for a child that does.
const SHARE_AT = '__shareAt'

// The document a region's maker is handed and builds its nodes from.
const DOCUMENT = '__document'

// A run's anchors while it holds markup (32.31), as the JS string literals a built run parses with.
const RAW_OPEN_MARKUP = JSON.stringify(`<!--${RAW_OPEN}-->`)
const RAW_CLOSE_MARKUP = JSON.stringify(`<!--${RAW_CLOSE}-->`)

// A NESTED REGION'S BODY, in the order the emitted function needs it: its walk first, then its
// helpers, then its units.
function regionBody(region: RegionEmitted): string[] {
    return [...region.chain, ...region.helpers, ...region.lines]
}

// WHAT MAKES A REGION'S NODES, as the body of a function taking the region's `__document`: the
// row, the arm, the slot's fallback, the caller's children and the page that fills itself are all
// made the same way. BUILT from the positions the markup walk placed (`emitBuild`) — or, where the
// region holds content only the parser makes right (`isParserOwned`), PARSED from the very markup
// the server writes, which is the one representation that cannot disagree with it.
//
// THE MARKUP IS ASKED FOR ONLY WHERE IT IS USED, as a thunk: writing it binds the markup writer's
// names (`escapeText`, `slotValue`), and a module that builds would import them for nothing.
function emitMaker(
    sink: Cursor,
    lowering: Lowering,
    markup = (): string => renderMarkup(sink, lowering, true),
    anchored = false,
): string {
    // A REGION MADE ONCE IS PARSED. One parse of a whole region costs what building it costs
    // (measured at 86-100% of building it) and ships as the markup string rather than as the code that builds it
    // — building a docs page's own fill was +4.3% gzipped on the whole client for nothing.
    let parsed = !sink.repeated
    for (const at of sink.positions) parsed ||= at.parserOwned
    if (parsed)
        return `return ${lowering.use('markupNodes')}(${DOCUMENT}, ${markup()})`
    return emitBuild(sink, anchored, lowering)
}

// A ROW THE BROWSER BUILDS, from the positions the markup walk placed for it — the same positions
// the row's mount walks (`emitRegion`), under the same slot names. So a row has one description:
// the server writes it as bytes, `make` builds it, `mount` finds it, and none of the three can
// disagree about where a node stands.
//
// BUILT RATHER THAN PARSED, and the whole of why: `markupNodes` sets `template.innerHTML` once a
// row, measured (`bun run bench:reorder`) at ~19 µs a row and ~90% of building a list, and ~88% of
// it FIXED — what costs is invoking the parser, not parsing. A row that reads PAGE state priced at
// n=1000 (`selectedRowShare.ts`): 21.6-22.2 ms parsed, 3.5-3.6 ms built, the parsed layer alone
// longer than a frame. The server is untouched; only a row the browser grows goes through `make`.
//
// THE BUILD WRITES WHAT THE MARKUP WRITES, MINUS WHAT THE MOUNT WILL WRITE. `makeRow` calls `make`
// and then `mount`, so a value the mount binds — a run or an attribute reading a `Reactive` — is
// written by the binding's first run and the build leaves it: a live run is an empty text node, a
// live attribute is not set. Everything else takes the value the parser would have made of the
// server's bytes — `escapeless` for an expression, and the build's own decode for a static one
// (`decodeCharacterReferences`). A merged `class` or `style` is
// written whole, through the same structure the markup takes (`mergedValue`), so the two are one
// string.
//
// A BLANK RUN IS BUILT ONLY WHEN IT HAS SOMETHING IN IT, because that is what the server does: a
// run of expressions that stringify to '' writes no node, and the mount's walk puts one back
// (`runHere`) exactly where it would for a row the server painted.
//
// A NESTED REGION IS AN EMPTY ANCHOR PAIR, filled by its own machinery on the mount's first run
// (`isEmptyRegion`), and a component or a slot is the same pair filled by the child.
function emitBuild(row: Cursor, anchored: boolean, lowering: Lowering): string {
    const lines: string[] = ['const __built = []']
    if (anchored)
        lines.push(
            `__built.push(${DOCUMENT}.createComment(${JSON.stringify(ROW_OPEN)}))`,
        )
    const render = buildRender(lowering)
    const into = (at: Position, node: string): string =>
        at.within === null
            ? `__built.push(${node})`
            : `${at.within.name}.appendChild(${node})`
    for (const at of row.positions) {
        if (at.kind === 'region') {
            lines.push(
                into(
                    at,
                    `${DOCUMENT}.createComment(${JSON.stringify(REGION_OPEN)})`,
                ),
                into(
                    at,
                    `${DOCUMENT}.createComment(${JSON.stringify(REGION_CLOSE)})`,
                ),
            )
            continue
        }
        if (at.kind === 'text') {
            for (const line of builtRun(at, lowering, into)) lines.push(line)
            continue
        }
        lines.push(
            `const ${at.name} = ${DOCUMENT}.createElement(${JSON.stringify(at.tag)})`,
        )
        for (const written of writtenAttributes(at.holder as ElementNode)) {
            const value = builtAttribute(written, lowering, render)
            if (value === null) continue
            const set = `${at.name}.setAttribute(${JSON.stringify(written.name)}, `
            // 32.38 — a whole-value attribute may be absent, which the server wrote as nothing.
            lines.push(
                written.kind === 'dynamic'
                    ? `{ const __text = ${value}; if (__text !== null) ${set}__text) }`
                    : `${set}${value})`,
            )
        }
        lines.push(into(at, at.name))
    }
    lines.push('return __built')
    return lines.join('\n    ')
}

// A RUN, BUILT. What the server writes for a run is its static bytes and each expression escaped —
// except a `Raw` value (32.27), whose html goes in unescaped, is PARSED into elements, and is
// anchored (`markupRun`). A text node cannot hold that, so a run whose expression answers a `Raw`
// is parsed from the very markup the server writes for it, anchors and all — the parser for the one
// thing only it makes — and every other run is one text node. The check is an `instanceof` a piece,
// which is what `escapeText` pays already.
//
// A run reading a `Reactive` is the mount's to write: an empty node where the run always renders
// one, and none where it can render none (a blank run), which is what the server leaves too.
function builtRun(
    at: Position,
    lowering: Lowering,
    into: (at: Position, node: string) => string,
): string[] {
    const make = (text: string): string =>
        into(at, `${DOCUMENT}.createTextNode(${text})`)
    if (isLiveRun(at.run, lowering)) return at.blank ? [] : [make("''")]
    const lines: string[] = []
    const text: string[] = []
    const markup: string[] = []
    const raw: string[] = []
    for (let piece = 0; piece < at.run.length; piece += 1) {
        const node = at.run[piece] as TemplateNode
        if (node.kind === 'text') {
            text.push(
                JSON.stringify(decodeCharacterReferences(node.text, 'text')),
            )
            markup.push(JSON.stringify(node.text))
            continue
        }
        const value = `${at.name}_${piece}`
        lines.push(`const ${value} = ${lowering.slot(node)}`)
        text.push(`${lowering.use('escapeless')}(${value})`)
        markup.push(`${lowering.use('escapeText')}(${value})`)
        raw.push(`${lowering.use('isRaw')}(${value})`)
    }
    const whole = text.length === 0 ? "''" : text.join(' + ')
    if (raw.length === 0) {
        lines.push(make(whole))
        return lines
    }
    lines.push(
        `if (${raw.join(' || ')}) for (const __made of ${lowering.use('markupNodes')}(${DOCUMENT}, ${RAW_OPEN_MARKUP} + ${markup.join(' + ')} + ${RAW_CLOSE_MARKUP})) ${into(at, '__made')}`,
    )
    if (!at.blank) {
        lines.push(`else ${make(whole)}`)
        return lines
    }
    lines.push(`else if ((${at.name} = ${whole}) !== '') ${make(at.name)}`)
    lines.splice(lines.length - 2, 0, `let ${at.name}`)
    return lines
}

// One attribute's value as `setAttribute` takes it, or null for one the build leaves alone.
function builtAttribute(
    written: WrittenAttribute,
    lowering: Lowering,
    render: ValueRender,
): string | null {
    if (written.kind === 'merged') return mergedValue(written, lowering, render)
    // 32.5, 32.11 — a bind and a spread are written by their bindings, installed on a built row too.
    if (written.kind === 'bound' || written.kind === 'spread') return null
    if (written.kind === 'dynamic') {
        if (lowering.isLive(written.attribute)) return null
        return `${lowering.use('attributeText')}(${JSON.stringify(written.name)}, ${lowering.slot(written.attribute)})`
    }
    if (written.value === '') return "''"
    // 32.29 — a URL attribute's bytes are its value escaped whole, so they decode back to it exactly.
    return render.bytes(staticAttributeBytes(written.lowerName, written.value))
}

// The build's half of `ValueRender`: what the parser makes of each piece the markup escapes. A
// merge member reading a `Reactive` is still evaluated here, under 41.4's guard, because a merged
// attribute is written whole or not at all.
function buildRender(lowering: Lowering): ValueRender {
    const guarded = (attribute: Attribute): string =>
        `${lowering.use('escapeless')}(${unlandable(lowering, attribute, lowering.slot(attribute))})`
    return {
        dynamic: guarded,
        declaration: (attribute) =>
            `${lowering.use('oneStyleValue')}(${guarded(attribute)})`,
        bytes: (bytes) =>
            JSON.stringify(decodeCharacterReferences(bytes, 'attribute')),
    }
}

// A REGION NOBODY PAINTED, as the pair that fills it: `_build` for the nodes and `_mount` for the
// bindings. 32.18 and 32.19 are the same mechanism from two sides — a caller's children handed to a
// child, and the child's own fallback for a slot nothing was passed — so they are one emitter
// rather than two that have to be kept byte-compatible by hand.
function emitFillable(
    name: string,
    sink: Cursor,
    lowering: Lowering,
    helpers: string[],
    counter: Counter,
): void {
    const region = emitRegion(sink, lowering, counter)
    helpers.push(
        `function ${name}_build(__document) {\n    ${emitMaker(sink, lowering)}\n}`,
    )
    helpers.push(
        mountFunction(
            name,
            REGION_ROOT,
            regionBody(region),
            `${lowering.use('fillRegion')}(${REGION_ROOT}, ${name}_build)`,
            lowering,
            sink.holdsComponent,
        ),
    )
}

// 41.10 — A MISMATCH REBUILDS THIS BLOCK OR ROW AND NOTHING WIDER. What the server wrote is what
// hydration walks; where it disagrees, it is re-rendered from the same markup a swap or a new row
// uses (`rebuild`) and wired again. `__rebuilt` is what stops a document that disagrees for some
// other reason from rebuilding forever — the second failure is the author's to see.
function mountFunction(
    name: string,
    parameters: string,
    body: string[],
    rebuild: string,
    lowering: Lowering,
    resumes: boolean,
): string {
    // A BODY THAT BINDS NOTHING HAS NOTHING TO STOP AND NOTHING TO REFUSE, so it opens no scope
    // and no `try`: every mount of it answers the one shared empty scope. A static row's two
    // allocations — the `Scope` and its `stops` — are otherwise paid per row for a body that is
    // empty.
    if (body.length === 0)
        return `const ${name}_mount = () => ${lowering.use('EMPTY_SCOPE')}`
    return [
        `const ${name}_mount = (${parameters}, __rebuilt) => {`,
        // 10.5 — the instance's own scope, put back for a mount that happens later than its
        // caller's. Only where a component stands below this region: nothing else can read it.
        ...(resumes
            ? [
                  `    const __back = ${lowering.use('resumeShare')}(${SHARE_AT})`,
                  `    try {`,
              ]
            : []),
        `    const ${SCOPE} = new ${lowering.use('Scope')}()`,
        `    try {`,
        ...body.map((line) => `        ${line}`),
        `    } catch (thrown) {`,
        `        ${SCOPE}.stop()`,
        `        if (__rebuilt || !${lowering.use('warnMismatch')}(thrown)) throw thrown`,
        `        ${rebuild}`,
        `        return ${name}_mount(${parameters}, true)`,
        `    }`,
        `    return ${SCOPE}`,
        ...(resumes
            ? [`    } finally { ${lowering.use('leaveShare')}(__back) }`]
            : []),
        `}`,
    ].join('\n')
}

// 32.18 ON THE CLIENT — the child mounts ITSELF, against the region its markup was written into.
// The parent hands over the same accessors it handed the server emitter (33.5), so the prop is the
// caller's expression on both sides and the child re-reads it when the parent's value moves.
//
// THE CHILD'S MOUNT IS ITS OWN MODULE'S. `import Total from './Total.abide'` is the default export
// of the client module that file compiled to (`componentImports`), so the binding the author wrote
// is the function called here — the parent emits no copy of the child's bindings, and a child
// changed in place is re-emitted alone.
function emitInvocation(
    at: Position,
    node: ElementNode,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const props = invocationProps(node, lowering)
    // 32.19 — THE CHILDREN ARE MARKUP AND A MOUNT, and they have to be both: the markup is what
    // fills a slot the server never painted, and the mount is the CALLER's bindings — which only
    // this module has, addressed from a region only the child knows where to put.
    const children = at.inner[0]
    if (children !== undefined) {
        const kids = claim(counter, 'kd')
        emitFillable(kids, children, lowering, helpers, counter)
        props.push(
            `${JSON.stringify(CHILDREN)}: () => ({ build: ${kids}_build, mount: ${kids}_mount })`,
        )
    }
    // THE CHILD'S SCOPE IS OWNED. Its bindings live as long as its nodes do, and what removes
    // those nodes is this region — a row that leaves, an arm that swaps — so the scope that stops
    // them has to be the one this region holds. Held rather than drained, because a child holding
    // an arm or a list of its own owns scopes that its disposer list does not reach.
    //
    // 14.7 — the call runs the child's setup, and nothing it reads subscribes a caller: an arm's
    // swap and a list's rows both mount untracked (`emitBlock`, `updateList`).
    const chosen = lowering.chosenTag(node)
    if (chosen === undefined) {
        lines.push(
            `${SCOPE}.own(${node.tag}(${lowering.use('regionFound')}(${at.name}), { ${props.join(', ')} }))`,
        )
        return
    }
    // 32.35, 32.36 — A TAG CHOOSING BY A VALUE IS AN `{#if}` WHOSE ARMS ARE COMPONENTS: the watch
    // reads which, and the swap runs untracked (`emitBlock`). The first run hydrates what the server
    // painted, and a later one empties the region for the next child to fill itself — the fill an
    // invoked component already makes where no server painted (32.18). The props record is the
    // caller's accessors, so one record serves every child the value chooses.
    //
    // 10.5 — a swap after the first runs from the watch, with no instance on the stack.
    // 32.37 — an absent value mounts nothing, and the region it leaves is the empty pair.
    const name = claim(counter, 'dc')
    lines.push(`const ${name} = ${lowering.use('regionFound')}(${at.name})
const ${name}_scope = ${SCOPE}.own(new ${lowering.use('Scope')}())
const ${name}_props = { ${props.join(', ')} }
let ${name}_at
const ${name}_swap = (next) => {
    if (${name}_at != null) {
        ${name}_scope.stop()
        ${lowering.use('fillRegion')}(${name})
    }
    ${name}_at = next
    if (next == null) return
    const back = ${lowering.use('resumeShare')}(${SHARE_AT})
    try {
        ${name}_scope.own(next(${name}, ${name}_props))
    } finally {
        ${lowering.use('leaveShare')}(back)
    }
}
${SCOPE}.watch(() => {
    const next = ${chosen}
    if (next !== ${name}_at) ${lowering.use('untracked')}(${name}_swap, next, undefined)
})`)
}

// 32.19 ON THE CHILD'S SIDE — the position the caller's children render into. Not a watch and not
// a swap: whether children were given is fixed at the call site, so this is read once and the
// region holds whichever of the two was decided there for the rest of its life.
//
// THE FALLBACK IS THE CHILD'S OWN, so it is emitted here as an arm is — its markup for a region
// nobody painted, its bindings for one somebody did.
function emitSlot(
    at: Position,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const name = claim(counter, 'sl')

    emitFillable(name, at.inner[0] as Cursor, lowering, helpers, counter)

    // THE EMPTY REGION IS THE ONE THE SERVER DID NOT PAINT — a child built in the browser (32.18)
    // or a page navigated to (30.7). Filled from whichever side owns what goes there, and then
    // mounted from the same side, so the markup and the bindings can never come from two.
    lines.push(`const ${name} = ${lowering.use('regionFound')}(${at.name})
const ${name}_kids = ${PROPS}[${JSON.stringify(CHILDREN)}] === undefined ? undefined : ${PROPS}[${JSON.stringify(CHILDREN)}]()
if (${lowering.use('isEmptyRegion')}(${name})) ${lowering.use('fillRegion')}(${name}, ${name}_kids === undefined ? ${name}_build : ${name}_kids.build)
${SCOPE}.own(${name}_kids === undefined ? ${name}_mount(${name}) : ${name}_kids.mount(${name}))`)
}

// 32.12 — one arm renders. The SERVER already rendered one, so the first run HYDRATES it rather
// than replacing it: a page that re-renders every region on load creates every node twice and
// throws away the document it was sent. The condition is evaluated once a run, the first run
// included — the arm hydrated is the arm the watch then compares against.
function emitBlock(
    at: Position,
    block: Extract<TemplateNode, { kind: 'block'; block: 'if' }>,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const name = claim(counter, 'rg')
    const fillRegion = lowering.use('fillRegion')

    // Which arm takes, as one expression. `{:else}` carries no condition and is the floor; with no
    // `{:else}` the floor is one arm past the last, which builds nothing and binds nothing.
    const floor = block.branches.at(-1)?.subject !== ''
    let take = String(block.branches.length)
    for (let arm = block.branches.length - 1; arm >= 0; arm -= 1) {
        const branch = block.branches[arm] as (typeof block.branches)[number]
        take =
            branch.subject === ''
                ? String(arm)
                : `(${lowering.expression(branch)}) ? ${arm} : ${take}`
    }
    const mounted = emitArms(
        name,
        at,
        lowering,
        helpers,
        counter,
        undefined,
        block.branches.map((branch) => branch.setup),
        floor,
    )
    // HELD RATHER THAN PUSHED, because a block is ONE unit: `${name}` is read by the watch below
    // and a caller that guards its units apart (`emitClient`) would put a `const` in one block and
    // its only reader in the next. Every name a unit declares is read inside it — that is what
    // makes a unit independent, and it is the property the page's per-binding guard rests on.
    const address = `const ${name} = ${lowering.use('regionFound')}(${at.name})`
    const isEmptyRegion = lowering.use('isEmptyRegion')

    // ONE SCOPE FOR THE BLOCK'S WHOLE LIFE, owned by the region above it and REFILLED on every
    // swap rather than replaced. A fresh scope per swap would have to be handed up per swap too,
    // and a toggle clicked a thousand times would leave a thousand of them on the region that
    // outlives it; `stop()` clears, so the same one holds only the arm currently standing.
    // `undefined` IS "NOT YET MOUNTED" and nothing else: `take` is always an arm index, so the
    // assignment moving below the guard is the whole of the flag.
    //
    // AND THE FIRST RUN FILLS AN EMPTY REGION RATHER THAN HYDRATING ONE. 41.4 lets a render
    // continue past a subject still in flight, and what the server writes then is the anchor pair
    // with nothing between it (see `emitComponent`'s `{#if}` arm) — so hydrating here walks for
    // nodes that were never painted. `isEmptyRegion` is the same signal an invoked component
    // already reads (32.18), asked ONCE on the first run: from the second onward `${name}_at` is
    // set and the fill happens anyway, so the region is never scanned twice for it.
    //
    // ARMS THAT BIND NOTHING ARE ONLY FILLED: there is no mount to call and no scope to stop.
    //
    // 14.1, 14.7, 14.8 — THE SWAP RUNS UNTRACKED, and it is the one place that has to: the watch
    // decides which arm and must wake for nothing else, while the swap sets the arm up (its
    // branch-local `<script>`), builds it (every value its markup writes) and mounts it (every
    // component's setup inside it). What the arm reads is kept live by its own mount's bindings.
    //
    // 14.2 — A CHAIN WHOSE EVERY SUBJECT IS PROVEN STATIC IS DECIDED ONCE, by the same body run as a
    // block rather than as a watch: the arm it takes can never change, and a watch over it is a
    // reader that can never wake. Unproven, the watch stays, and tracking decides what it reads.
    let decided = true
    for (const branch of block.branches)
        if (branch.subject !== '' && lowering.isLive(branch)) decided = false
    lines.push(`${address}
let ${name}_at${mounted ? `\nconst ${name}_scope = ${SCOPE}.own(new ${lowering.use('Scope')}())` : ''}
const ${name}_swap = (next) => {
    const filling = ${name}_at !== undefined || ${isEmptyRegion}(${name})
    ${name}_at = next
    const arm = ${name}_arms[next]()
    ${
        mounted
            ? `if (filling) {
        ${name}_scope.stop()
        ${fillRegion}(${name}, arm.build)
    }
    ${name}_scope.own(arm.mount(${name}))`
            : `if (filling) ${fillRegion}(${name}, arm.build)`
    }
}
${decided ? '{' : `${SCOPE}.watch(() => {`}
    const next = ${take}
    if (next !== ${name}_at) ${lowering.use('untracked')}(${name}_swap, next, undefined)
${decided ? '}' : '})'}`)
}

// 32.16 — A `{#try}` TAKES ITS BODY UNTIL SOMETHING IN IT FAILS, and its catch from then until the
// failure clears. The boundary is the region's, and the catch reads the failure by the name the
// author bound. Two arms, so the arm taken is `0` or `1` and never the `{#if}` floor.
function emitTry(
    at: Position,
    block: Extract<TemplateNode, { kind: 'block'; block: 'try' }>,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const name = claim(counter, 'rg')
    const fillRegion = lowering.use('fillRegion')
    const inBoundary = lowering.use('inBoundary')
    const boundary = `${name}_boundary`
    // HANDED IN, not read off the boundary: the arms are hoisted where the region's own names are
    // out of reach, and each instance has a failure of its own. The catch's binding is its setup.
    emitArms(
        name,
        at,
        lowering,
        helpers,
        counter,
        block.error === '' ? '' : `const ${block.error} = __caught`,
        undefined,
        false,
    )

    // THE BODY BUILDS AND MOUNTS UNDER THE BOUNDARY, the catch outside it — a catch arm that throws
    // is not its own catch's to swallow. A failure raised while this run builds the body does not
    // wake this run, so the run reads the boundary again and goes round: a body that failed as it
    // was built is not mounted, and one that failed as it mounted is replaced. ONE UNIT, for
    // `emitBlock`'s reason.
    //
    // AND THE FIRST RUN HYDRATES THE ARM THE SERVER PAINTED. Where the server's render failed its
    // anchor says so (`REGION_CAUGHT`), and the body is evaluated under the boundary for the failure
    // the catch binds — without being filled, so the catch the server sent is the one adopted. A
    // body that succeeds here after failing there empties the region, and the run fills it.
    lines.push(`const ${name} = ${lowering.use('regionFound')}(${at.name})
let ${name}_at
const ${name}_scope = ${SCOPE}.own(new ${lowering.use('Scope')}())
const ${boundary} = ${SCOPE}.own(new ${lowering.use('TryBoundary')}())
// Building the body evaluates it, so a failed body is retried by building it again.
const ${name}_again = () => ${name}_arms[0]().build(document)
// Swapped untracked, as an {#if} arm is: only the failure decides which arm.
const ${name}_swap = (next) => {
    while (next !== ${name}_at) {
        const filling = ${name}_at !== undefined || ${lowering.use('isEmptyRegion')}(${name})
        ${name}_at = next
        const arm = ${name}_arms[next](${boundary}.failure.peek())
        if (filling) {
            ${name}_scope.stop()
            if (next === 0 && ${inBoundary}(${boundary}, () => (${fillRegion}(${name}, arm.build), true), ${name}_again) === undefined) {
                next = 1
                continue
            }
            if (next === 1) ${fillRegion}(${name}, arm.build)
        }
        ${name}_scope.own(next === 0 ? ${inBoundary}(${boundary}, () => arm.mount(${name}), ${name}_again) : arm.mount(${name}))
        next = ${boundary}.failure.peek() === undefined ? 0 : 1
    }
}
${SCOPE}.watch(() => {
    if (${name}_at === undefined && ${name}.open.data === ${JSON.stringify(REGION_CAUGHT)} && ${inBoundary}(${boundary}, ${name}_again, ${name}_again) !== undefined) ${fillRegion}(${name})
    const next = ${boundary}.failure() === undefined ? 0 : 1
    if (next !== ${name}_at) ${lowering.use('untracked')}(${name}_swap, next, undefined)
})`)
}

// A BLOCK'S ARMS, each set up the way `List.setUp` sets up a row: `${name}_arms[arm]` is called once
// each time that arm is swapped in, and answers the arm's `{ build, mount }`. An arm with a setup of
// its own — a branch-local `<script>` (14.8), or the `{#try}` catch's binding of the failure it is
// handed — declares its builder and mount after it, so both close over its names; every other arm
// answers the one record built with the region. With `floor`, one more arm past the last builds
// nothing and binds nothing: the `{#if}` with no `{:else}` and no subject true.
function emitArms(
    name: string,
    at: Position,
    lowering: Lowering,
    helpers: string[],
    counter: Counter,
    // The `{#try}` catch's binding, `''` where it binds no name; `undefined` for an `{#if}`.
    caught: string | undefined,
    // 14.8 — each `{#if}` arm's branch-local `<script>`, or `null`.
    setups: readonly (Setup | null)[] | undefined,
    floor: boolean,
): boolean {
    const fillRegion = lowering.use('fillRegion')
    const arms: string[] = []
    // A `{#try}` always mounts: its catch binds the failure, and its body mounts under the boundary.
    let mounted = caught !== undefined
    for (let arm = 0; arm < at.inner.length; arm += 1) {
        const sink = at.inner[arm] as Cursor
        const own = `${name}_a${arm}`
        // A NESTED REGION'S HELPERS BELONG TO THE SCOPE THAT OWNS THEM. Hoisted to `mount` they
        // read names this arm binds and nothing else does, which is a ReferenceError at the first
        // swap rather than at compile time. AND SO DOES ITS WALK, for the same reason: each arm's
        // mount is a function of its own, so two arms may name a slot `__c0` and neither can see
        // the other's.
        const body = regionBody(emitRegion(sink, lowering, counter))
        if (body.length > 0) mounted = true
        const setup = setups?.[arm] ?? null
        const local =
            setup !== null
                ? lowering.setup(setup)
                : arm === 1 && caught !== undefined
                  ? caught
                  : ''
        const builders = `const ${own}_build = function (__document) {\n${emitMaker(sink, lowering)}\n}\n${mountFunction(own, REGION_ROOT, body, `${fillRegion}(${REGION_ROOT}, ${own}_build)`, lowering, sink.holdsComponent)}`
        if (local === '') {
            helpers.push(
                `${builders}\nconst ${own}_arm = { build: ${own}_build, mount: ${own}_mount }`,
            )
            arms.push(`() => ${own}_arm`)
        } else
            arms.push(
                `(__caught) => {\n${local}\n${builders}\nreturn { build: ${own}_build, mount: ${own}_mount }\n}`,
            )
    }
    if (floor) {
        helpers.push(
            `const ${name}_floor = { build: undefined, mount: () => ${lowering.use('EMPTY_SCOPE')} }`,
        )
        arms.push(`() => ${name}_floor`)
    }
    helpers.push(`const ${name}_arms = [\n${arms.join(',\n')}\n]`)
    return mounted
}

// 32.13 — the list. The server already rendered the rows, so the first update HYDRATES them:
// every row's element is already in the document and only its bindings are missing. Only a change
// to the list reconciles, and only the rows that moved move.
//
// 32.22 — the subject is read ONCE for the block. 32.23 — an absent subject iterates zero times.
function emitList(
    position: Position,
    block: Extract<TemplateNode, { kind: 'block'; block: 'for' }>,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const name = claim(counter, 'ls')

    const row = position.inner[0] as Cursor
    const subject = lowering.expression(block)
    // THE ROW BINDS ITS OWN NAME. Every emitted row function takes the author's item and index as
    // its parameters, so the body's expressions read exactly what the author wrote and nothing
    // rewrites already-emitted source — a rename by regex reaches inside static text and cannot
    // reach a nested region's helper at all.
    const item = block.item
    const at = block.index === '' ? '__at' : block.index
    // 41.8 — with no `by`, the key is the POSITION, which is 32.13's positional reconcile: a row
    // is whatever is in that slot, and a reorder rewrites the rows rather than moving them.
    // 31.10 — the item and the index SHADOW the page's names for the row, and the projection is
    // what says so: they are a `for … of` binding there, so no read in the body or the key reaches
    // the page's name of the same spelling.
    const written = `(${item}, ${at}) => ${block.key === '' ? at : lowering.key(block)}`
    // 32.33 — ONLY A NAME ALONE hands the list its `Reactive`. Any other subject is a value computed
    // from one, which declared no `by` of its own, and evaluating it a second time to ask would run
    // the computation twice. `reference` keeps the name the `Reactive` (31.3) rather than a read.
    const key =
        block.key === '' && isNamedAlone(block.subject.trim())
            ? `${lowering.use('rowKeyOf')}(${lowering.reference(block)}, ${written})`
            : written

    const single = isSingleRooted(block.children)

    const rowRegion = emitRegion(row, lowering, counter)

    // `List` hands the row its document — see `emitMaker` for which rows are parsed instead.
    const make = `const ${name}_make = (__document, ${item}, ${at}) => {\n    ${emitMaker(row, lowering, () => emitRow(row, !single, lowering, true), !single)}\n}`

    // A row that cannot be hydrated is REBUILT by the same `make`, in place, and the row's record
    // takes its new first node.
    const builders = [
        make,
        mountFunction(
            name,
            `${ROW_ROOT}, ${item}, ${at}`,
            // The row's walk, INSIDE the mount's one `try` rather than above it, because a row
            // rebuilds whole: a node that refused is the row disagreeing, and re-making it is the
            // answer the page does not have.
            regionBody(rowRegion),
            `${lowering.use('replaceRow')}(${ROW_ROOT}, ${name}_make(${ROW_ROOT}.node.ownerDocument, ${item}, ${at}))`,
            lowering,
            row.holdsComponent,
        ),
    ].join('\n')
    // THE LIST CALLS `_setUp` ONCE PER ROW (`List.setUp`). 14.8 — a row with a branch-local
    // `<script>` runs it there, and the row's `make` and `mount` are declared after it, so both close
    // over its names and neither runs it again. Every other row gets the list's one record back.
    helpers.push(
        [
            // What the subject iterates as is `listOf`'s question, asked inside the runtime.
            `const ${name}_subject = () => ${subject}`,
            `const ${name}_key = ${key}`,
            block.setup !== null
                ? `const ${name}_setUp = (${item}, ${at}) => {\n${lowering.setup(block.setup)}\n${builders}\nreturn { make: ${name}_make, mount: ${name}_mount }\n}`
                : `${builders}\nconst ${name}_builders = { make: ${name}_make, mount: ${name}_mount }\nconst ${name}_setUp = () => ${name}_builders`,
        ].join('\n'),
    )

    // ONE UNIT, for `emitBlock`'s reason: the list's region and the `List` built over it are both
    // read by the watch, so the three lines cannot be guarded apart.
    // OWNED BY THE REGION ABOVE IT: `dropRow` stops a row as the list churns, but a block removed
    // whole drops no rows, so `List.stop` is what reaches the ones still standing.
    lines.push(
        `const ${name} = ${lowering.use('regionFound')}(${position.name})
const ${name}_list = ${SCOPE}.own(${lowering.use('listAt')}(${name}, ${single ? 'false' : 'true'}, ${name}_key, ${name}_setUp))
${SCOPE}.watch(() => ${lowering.use('updateList')}(${name}_list, ${name}_subject()))`,
    )
}

// Whether any expression in the run is live (`Lowering.isLive`). A run of static parts and
// expressions the checker proved static is written once by the server and never again; opening a
// binding for it is one waking reader per run on a page for nothing.
function isLiveRun(run: TemplateNode[], lowering: Lowering): boolean {
    for (const piece of run)
        if (piece.kind === 'expression' && lowering.isLive(piece)) return true
    return false
}
