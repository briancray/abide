import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import { Cursor, placeTemplate } from './Cursor.ts'
import { Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    concat,
    definitions,
    HEADS,
    headSink,
    renderLevel,
    renderMarkup,
    SERVER_LANE,
} from './renderMarkup.ts'
import { SERVER_SPECIFIER } from './SPECIFIERS.ts'
import { insideShare, SETTLED_AT, shareScope } from './shareScope.ts'
import { splitImports, withoutProps } from './splitImports.ts'

// The name the body is bound to while a component's head contributions land (`HEADS`).
const BODY = '__body'
// A page's or a layout's deferred build (41.19).
const BUILT = '__built'
const BUILD = '__build'

/**
 * The server module for a parsed `.abide` file: one ESM module exporting its component.
 *
 * The `<script>` body is copied VERBATIM into the component function, which is the whole of 19.12
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
 * setup started are given the turn to answer that a component built inside its caller's markup is
 * not. Every other component builds where it is called, and pays nothing for the difference.
 */
export function emitComponent(
    file: AbideFile,
    answer: CheckerAnswer = UNCHECKED,
    settles = false,
    /** Where each specifier this file imports landed in the build (`splitImports`). */
    landed: ReadonlyMap<string, string> = new Map(),
): string {
    // Only what the page actually uses. An emitted module carrying an import nothing calls is a
    // name the app's own tooling reports as unused, in a file nobody wrote.
    const lowering = new Lowering(file, answer)

    const page = new Cursor()
    page.components = file.components
    placeTemplate(file.template, page)
    const body = renderLevel(page.top, lowering, SERVER_LANE)
    // 32.43 — the template's own components, declared where the body is built: they read the
    // setup's names, and a child they invoke adds its head to the body's.
    const declared = definitions(page, lowering)

    // EMITTED AFTER THE BODY, NOT BEFORE. 39.12 merges across the whole FILE, so a second `<head>`
    // further down the template shadows the first one's `<title>` — and `emitNode` adds to `used`,
    // so emitting a contribution the merge then drops leaves the module importing a name nothing
    // calls. `headSink` is the client lane's too, which is what keeps the two from drifting.
    const head = renderMarkup(headSink(file), lowering, SERVER_LANE)

    // 31.1 and 31.4 hold INSIDE a `.abide` file, not just in its template, so the script block is
    // lowered with the same rewrite the slots get.
    //
    // 34.2 — A `<script module>` IS REQUEST-LOCAL ON A SERVER, which is the head of the component
    // rather than module scope: at module scope it is evaluated once per PROCESS and every request
    // after the first sees the first one's values. One `Component()` call is one request today,
    // and this moves the moment 32.17 lets a component be invoked more than once inside one.
    const moduleSetup = splitImports(lowering.modules(), '', landed)
    const setup = splitImports(lowering.scripts(), '', landed)
    const componentBody = [moduleSetup.body, setup.body]
        .filter((part) => part !== '')
        .join('\n')

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
    }`
    // 41.19 — BUILT ON THE FIRST READ, and ONCE: `render` reads `head` and then `body`, and a
    // child the markup invokes must not be set up twice. The build resumes the share scope the
    // setup ran in (10.5), since by the time it is read the caller's has long been left — and that
    // scope is `scope` on the answer, so `composePage` sets the level below up inside it too.
    const level = settles
        ? `    const ${SETTLED_AT} = ${lowering.use('currentShare')}()
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
    }`
        : build
    return `${moduleImports(lowering, () => SERVER_SPECIFIER, [moduleSetup, setup])}
export default function Component(${lowering.takesProps() ? `${PROPS} = {}` : ''}) {
${opened}${componentBody}
${level}${closed}
}
`
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
 * helpers are public on `abide`, so an author may import the same name into the same `<script>` —
 * `import { safeUrl } from './mine.ts'` beside one `<a href={u}>` was
 * `Identifier 'safeUrl' has already been declared` — and a `<script module>` declaring `setText` at
 * module scope collides with a runtime import made as written just the same.
 */
function importClause(names: string[]): string {
    const written: string[] = []
    for (const name of names) written.push(`${name} as __${name}`)
    return written.join(', ')
}
