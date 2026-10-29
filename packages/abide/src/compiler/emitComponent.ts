import type { JsonValue } from '#shared/JsonValue.ts'
import { SERVER_SPECIFIER, SHARED_SPECIFIER } from '#shared/SPECIFIERS.ts'
import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import { Cursor, placeTemplate } from './Cursor.ts'
import { type LoweredChunk, Lowering, PROPS } from './Lowering.ts'
import { type AbideFile, scriptBodies } from './parseAbide.ts'
import { privateExports } from './projectShadow.ts'
import {
    concat,
    definitions,
    HEADS,
    headSink,
    renderLevel,
    renderMarkup,
    SERVER_LANE,
} from './renderMarkup.ts'
import { insideShare, SETTLED_AT, shareScope } from './shareScope.ts'
import { importStatements, splitImports, withoutProps } from './splitImports.ts'
import type { TemplateNode } from './TemplateNode.ts'

// The name the body is bound to while a component's head contributions land (`HEADS`).
const BODY = '__body'
// A page's or a layout's deferred build (41.19).
const BUILT = '__built'
const BUILD = '__build'
// The calls renders had made as a component's setup began (41.28).
const CALLS_BEFORE = '__callsBefore'

/**
 * The server module for a parsed `.abide` file: one ESM module exporting its component.
 *
 * The `<script>` body is copied VERBATIM into the component function, which is the whole of 19.11
 * at this stage: the compiler does not read the expression grammar, so anything TypeScript accepts
 * survives.
 *
 * The component returns its head and its body apart. 39.3 is why the split is HERE and not in
 * `render`: the hoist is a compile-time partition of the template, so the emitted function has
 * two returns rather than one string a renderer has to go looking through. 35.5 is answered by
 * `render`, which turns the two into the byte stream a document is served as.
 *
 * `settles` IS A PAGE OR A LAYOUT, which `render` builds a level at a time (41.19): its setup runs
 * at the call and its markup is built on the first read of `head` or `body`, so the calls the
 * setup started are given the turn to answer. Every other component answers the same way only where
 * its setup made a call or its markup reads a bare `busy` or `ready` (41.28), and builds where it is
 * called otherwise.
 */
export function emitComponent(
    file: AbideFile,
    answer: CheckerAnswer = UNCHECKED,
    settles = false,
    /** The route a `<script server>` files its hooks at (37.1). */
    route = '/',
    /** 38.97 — where given, every chunk the module is written around (`sourceMapOf`). */
    chunks?: LoweredChunk[],
    /** 19.9 — the schema each private handler's annotation derives, by its binding. */
    derived: Readonly<Record<string, JsonValue>> = {},
): string {
    // Only what the page actually uses. An emitted module carrying an import nothing calls is a
    // name the app's own tooling reports as unused, in a file nobody wrote.
    const lowering = new Lowering(file, answer, false, chunks)

    const page = new Cursor()
    page.components = file.components
    placeTemplate(file.template, page)
    const body = renderLevel(page.top, lowering, SERVER_LANE)
    // 32.43 — the template's own components, declared where the body is built: they read the
    // setup's names, and a child they invoke adds its head to the body's.
    const declared = definitions(page, lowering)

    // EMITTED AFTER THE BODY, NOT BEFORE. 39.12 merges across the whole FILE, so a second `<head>`
    // further down the template shadows the first one's `<title>` — and rendering a node adds to
    // `Lowering.used` (`lowering.use`), so emitting a contribution the merge then drops leaves the
    // module importing a name nothing calls. `headSink` is the client lane's too, which is what keeps the two from drifting.
    const head = renderMarkup(headSink(file), lowering, SERVER_LANE)
    // 35.15, 35.17 — THE DOCUMENT'S OWN TWO ELEMENTS, rendered as any element is and empty, so
    // `render` writes their attributes onto the document's and every live one is read per request.
    const document =
        file.document === undefined
            ? 'undefined'
            : `{ html: ${renderMarkup(placed([file.document.html]), lowering, SERVER_LANE)}, body: ${renderMarkup(placed([file.document.body]), lowering, SERVER_LANE)} }`

    // 31.1 and 31.4 hold INSIDE a `.abide` file, not just in its template, so the script block is
    // lowered with the same rewrite the slots get.
    //
    // 34.2 — A `<script module>` IS MODULE SCOPE, here as in the browser. What must stay per request
    // is a `reactive`, which is by 11.32 wherever it is declared.
    const moduleSetup = splitImports(lowering.modules())
    // 34.19 — A `<script server>` IS MODULE SCOPE ON THIS SIDE ALONE, run between two calls that
    // file every hook it makes at the file's route (37.1). Its body cannot await at its top level
    // (34.3), so nothing else runs inside the window.
    const serverSetup = splitImports(lowering.servers(), 'source')
    const serverBody =
        serverSetup.body === ''
            ? ''
            : `${lowering.use('fileRoute')}(${JSON.stringify(route)})
${serverSetup.body}
${lowering.use('fileRoute')}(undefined)
${heldToAnnotations(lowering, derived)}${privateExports(file.servers.join('\n'))}`
    const setup = splitImports(lowering.scripts())
    const componentBody = setup.body

    // A child invoked inside `<head>` pushes to the same array from the head expression.
    const heads =
        head.includes(HEADS) ||
        declared.includes(HEADS) ||
        body.some((part) => part.includes(HEADS))
    // 10.5 — around the setup that calls `reactive.share`, and the body whose children are
    // rendered inside it and find it on the way up.
    const { opened, closed } = shareScope(lowering, '    ')

    // THE SETUP IS NOT RE-INDENTED. Adding a margin to every line rewrites the INSIDE of a
    // multi-line template literal, so `\`line one\nline two\`` gains four spaces it never had —
    // a changed string constant, in a file nobody reads.
    // 39.1 THROUGH A COMPONENT. A child contributes to the document head as a page does, and the
    // call that renders it stands inside the BODY expression — so the heads are collected as the
    // body is built and the body is bound to a name before the return reads them. The array is
    // emitted only where the page invokes something: a page with no component pays nothing.
    // `head` is read before `__heads.join` in the return, so a child in the head lands too.
    const build = `${heads ? `    const ${HEADS} = []\n` : ''}${declared}\
    const ${BODY} = ${concat(body)}
    return {
        head: ${head}${heads ? ` + ${HEADS}.join('')` : ''},
        body: ${BODY},
        document: ${document},
    }`
    // 41.19 — BUILT ON THE FIRST READ, and ONCE: `render` reads `head` and then `body`, and a
    // child the markup invokes must not be set up twice. The build resumes the share scope the
    // setup ran in (10.5), since by the time it is read the caller's has long been left — and that
    // scope is `scope` on the answer, so `composePage` sets the level below up inside it too.
    const deferred =
        (): string => `    const ${SETTLED_AT} = ${lowering.use('currentShare')}()
    let ${BUILT}
    const ${BUILD} = () => {
        if (${BUILT} !== undefined) return ${BUILT}
        ${insideShare(lowering, SETTLED_AT, `${BUILT} = (() => {\n${build}\n})()`)}
        return ${BUILT}
    }
    return {
        scope: ${SETTLED_AT},
        get head() { return ${BUILD}().head },
        get body() { return ${BUILD}().body },
        get document() { return ${BUILD}().document },
    }`
    // 41.28 — EVERY OTHER COMPONENT BUILDS WHERE IT IS CALLED unless its setup
    // made a call, and then answers as a page does, for `renderComponent` to build after the turn.
    // THE BUILD IS WRITTEN TWICE rather than always run through `__build`: the closure measured ~4%
    // a row on `bench:component`'s card under JSC, the second copy nothing but server module bytes.
    // One with no setup cannot call, and is written once. One whose markup reads a bare `busy` or
    // `ready` answers as a page does always: built where it is called, it would answer before the
    // siblings after it had started a load, where the browser's answers once every setup has run.
    const probes =
        !settles &&
        readsBareProbe(file, `${head}\n${declared}\n${body.join('\n')}`)
    const waits = !settles && !probes && componentBody.trim() !== ''
    const level =
        settles || probes
            ? deferred()
            : waits
              ? `    if (${lowering.use('callsInRender')}() !== ${CALLS_BEFORE}) {
${deferred()}
    }
${build}`
              : build
    return `${moduleImports(lowering, () => SERVER_SPECIFIER, [moduleSetup, serverSetup, setup])}
${moduleSetup.body === '' ? '' : `${moduleSetup.body}\n`}${serverBody}export default function Component(${lowering.takesProps() ? `${PROPS} = {}` : ''}) {
${waits ? `    const ${CALLS_BEFORE} = ${lowering.use('callsInRender')}()\n` : ''}${opened}${componentBody}
${level}${closed}
}
`
}

/**
 * Whether `markup`, a component's emitted head and body, calls `busy` or `ready` with no argument,
 * under any name the file's scripts import either by from `@abide/abide`. A member's (`s.busy()`)
 * is not bare.
 */
function readsBareProbe(file: AbideFile, markup: string): boolean {
    let names = ''
    for (const script of scriptBodies(file))
        for (const statement of importStatements(script))
            if (statement.specifier === SHARED_SPECIFIER && !statement.typeOnly)
                for (const binding of statement.bindings)
                    if (
                        !binding.typeOnly &&
                        (binding.imported === 'busy' ||
                            binding.imported === 'ready')
                    )
                        names += `${names === '' ? '' : '|'}${binding.local}`
    return (
        names !== '' &&
        new RegExp(`(?<![\\w$.])(?:${names})\\(\\s*\\)`).test(markup)
    )
}

/**
 * 15.8, 19.9 — each private handler held to the schema its annotation derives, once its server block
 * has built it: the module is what the server mounts and what a component under `mount` calls
 * (38.121), so a call is held to it whoever makes it.
 */
function heldToAnnotations(
    lowering: Lowering,
    derived: Readonly<Record<string, JsonValue>>,
): string {
    let out = ''
    for (const name in derived)
        out += `${lowering.use('derivedArgs')}(${name}, ${JSON.stringify(derived[name])})\n`
    return out
}

/**
 * An emitted module's imports: each framework name `lowering` used, from the specifier it ships
 * under, and the author's own from both script blocks, already pointed where they landed
 * (`splitImports`).
 *
 * ASKED LAST, because `used` fills as the module is emitted.
 */
export function moduleImports(
    lowering: Lowering,
    specifierOf: (name: string) => string,
    scripts: readonly { imports: string }[],
): string {
    const names = new Map<string, string[]>()
    for (const name of [...lowering.used].sort()) {
        const specifier = specifierOf(name)
        names.set(specifier, [...(names.get(specifier) ?? []), name])
    }
    let out = ''
    for (const specifier of [...names.keys()].sort())
        out += `import { ${importClause(names.get(specifier) as string[])} } from '${specifier}'\n`
    for (const script of scripts) out += withoutProps(script.imports)
    return out
}

/**
 * The braces of a framework import: each name bound as `name as __name`.
 *
 * EVERY FRAMEWORK NAME IS BOUND UNDER `__`, the namespace an author does not write in: the escaping
 * helpers are public on `@abide/abide`, so an author may import the same name into the same `<script>` —
 * `import { safeUrl } from './mine.ts'` beside one `<a href={u}>` was
 * `Identifier 'safeUrl' has already been declared` — and a `<script module>` declaring `setText` at
 * module scope collides with a runtime import made as written just the same.
 */
function importClause(names: string[]): string {
    const written: string[] = []
    for (const name of names) written.push(`${name} as __${name}`)
    return written.join(', ')
}

// `nodes` placed on a sink of their own, as `headSink` places a head.
function placed(nodes: TemplateNode[]): Cursor {
    const sink = new Cursor()
    placeTemplate(nodes, sink)
    return sink
}
