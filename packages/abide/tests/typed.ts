import { type AbideFile, parseAbide } from '#compiler'
import type { CheckerAnswer } from '#compiler/CheckerAnswer.ts'
import { emitSource } from '#compiler/emitSource.ts'
import { Lowering } from '#compiler/Lowering.ts'
import { projectShadow } from '#compiler/projectShadow.ts'
import { parseSources, readSources } from '#compiler/readSources.ts'
import { Refusals } from '#compiler/Refusals.ts'
import { type Token, tokenize } from '#compiler/tokenize.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { placement } from '#server/placement.ts'
import { renderDocument } from '#server/render.ts'
import { flushSync } from '#shared'
import { pageRegion } from '#ui/regions.ts'
import type { Scope } from '#ui/Scope.ts'

import { servedModules } from './servedModules.ts'

// THE CHECKER DECIDES WHAT IS REACTIVE, so a test that means "`n` is a `Reactive` here" has to say
// so in a way the checker reads. `typed` declares every name it is given as one at module scope —
// `let n = reactive(undefined as any)` — unless the page already declares that name there, and
// hands back the file with its reads. Nothing about the answer is forged: the same session an app
// build opens is asked the same question.

// The fixture project every typed test is checked against, and the one session that checks it.
export const TYPED_ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const PAGE = `${TYPED_ROOT}src/typed.abide`

let session: TypeSession | undefined

export async function typedSession(): Promise<TypeSession> {
    session ??= await TypeSession.open(`${TYPED_ROOT}tsconfig.json`)
    return session
}

export async function closeTyped(): Promise<void> {
    await session?.close()
    session = undefined
}

// The source with every name in `names` declared as a `Reactive` in its first `<script>`, and the
// text that was put there — a caller cutting the declarations back off needs its length.
function declare(
    source: string,
    names: Iterable<string>,
): { source: string; prelude: string } {
    const open = /<script(\s[^>]*)?>/.exec(source)
    // Every block's own top level: a `<script module>` and the `<script>` under it are one scope.
    let body = ''
    for (const block of source.matchAll(
        /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g,
    ))
        body += `${block[1]}\n`
    const declared = moduleNames(body)
    let prelude = ''
    for (const name of names)
        if (!declared.has(name))
            prelude += `let ${name} = reactive(undefined as any);\n`
    if (
        (prelude !== '' || body.includes('reactive(')) &&
        !/import\s*\{[^}]*\breactive\b/.test(body)
    )
        prelude = `import { reactive } from '@abide/abide'\n${prelude}`
    if (prelude === '') return { source, prelude }
    if (open === null)
        return { source: `<script>${prelude}</script>${source}`, prelude }
    const at = open.index + open[0].length
    return {
        source: source.slice(0, at) + prelude + source.slice(at),
        prelude,
    }
}

// The names a script declares at its OWN top level — an inner block's `let n` is not the page's.
// The first name after each top-level `const`/`let`/`var`, which is all a fixture here writes.
function moduleNames(script: string): Set<string> {
    const names = new Set<string>()
    const tokens = tokenize(script)
    let depth = 0
    for (let i = 0; i < tokens.length; i += 1) {
        const text = (tokens[i] as Token).text
        if (text === '{' || text === '(' || text === '[') depth += 1
        else if (text === '}' || text === ')' || text === ']') depth -= 1
        else if (
            depth === 0 &&
            (text === 'const' || text === 'let' || text === 'var')
        )
            names.add(tokens[i + 1]?.text ?? '')
    }
    return names
}

export async function typed(
    source: string,
    names: Iterable<string> = [],
): Promise<{
    source: string
    prelude: string
    file: AbideFile
    answer: CheckerAnswer
}> {
    const declared = declare(source, names)
    const checker = await typedSession()
    // The pipeline a build runs, so a refusal throws here as it stops a build.
    const refusals = new Refusals(TYPED_ROOT, false)
    const { read } = await readSources(
        checker,
        parseSources([{ path: PAGE, text: declared.source }], refusals),
        refusals,
    )
    const [page] = read as [(typeof read)[number]]
    return {
        source: declared.source,
        prelude: declared.prelude,
        file: page.file,
        answer: page.answer,
    }
}

// A `<script>` body — or a `<script module>` one — lowered with `names` reactive, the declarations
// `typed` added cut back off.
export async function lower(
    script: string,
    names: Iterable<string> = [],
    used: Set<string> = new Set(),
    block: 'script' | 'script module' = 'script',
): Promise<string> {
    const { prelude, file, answer } = await typed(
        `<${block}>${script}</script>`,
        names,
    )
    const lowering = new Lowering(file, answer)
    const lowered = (
        block === 'script' ? lowering.scripts() : lowering.modules()
    ).slice(prelude.length)
    for (const name of lowering.used) used.add(name)
    return lowered
}

// The distinct names a set of reads lands on, sorted — what a test asserting WHICH names are
// reactive compares against.
export function namesRead(file: AbideFile, answer: CheckerAnswer): string[] {
    const text = projectShadow(file).text
    const names = new Set<string>()
    for (const read of answer.reads) names.add(text.slice(read.start, read.end))
    return [...names].sort()
}

// What a pending compile threw, or '' where it did not. `await expect(pending).rejects.toThrow()`
// hangs under bun rather than failing, so a refusal is read the long way.
export async function refusal(pending: Promise<unknown>): Promise<string> {
    try {
        await pending
    } catch (thrown) {
        return String(thrown)
    }
    return ''
}

// The client and server modules for a source with `names` reactive, as the build compiles a
// component nothing invokes at the fixture's path.
export async function clientOf(
    source: string,
    names: Iterable<string> = [],
): Promise<string> {
    const { file, answer } = await typed(source, names)
    // 23.21 — a fixture's component stands under a lib directory, where a file is no page.
    return emitSource({
        ...placement('lib/typed.abide'),
        file,
        answer,
        invoked: false,
    }).client
}

export async function serverOf(
    source: string,
    names: Iterable<string> = [],
): Promise<string> {
    const { file, answer } = await typed(source, names)
    // 23.21 — a fixture's component stands under a lib directory, where a file is no page.
    return emitSource({
        ...placement('lib/typed.abide'),
        file,
        answer,
        invoked: false,
    }).server
}

// 41.28 — a component whose setup may make a call is emitted with its build twice, deferred and
// inline (`emitComponent`); the inline one, for a test counting what one build writes.
export function inlineBuild(server: string): string {
    const deferredEnd = server.lastIndexOf('get document()')
    return deferredEnd === -1 ? server : server.slice(deferredEnd)
}

// A page, and any component file it invokes, compiled as the build compiles them, rendered by the
// server, and its body handed to `document.body` the way a browser would have arrived at it. The
// client's mount is handed back UNRUN, so a test can count what it does; run, it hydrates those very
// nodes and drains what the hydration scheduled. `client` is the page's client module.
export async function renderPage(
    page: string,
    components: Record<string, string> = {},
): Promise<{ html: string; client: string; mount: () => Scope }> {
    const checker = await typedSession()
    const modules: Record<string, { server: string; client: string }> = {}
    let pageClient = ''
    for (const [name, source] of Object.entries({
        ...components,
        Page: page,
    })) {
        const file = parseAbide(source)
        const isPage = name === 'Page'
        const reads = await checker.reads(
            `${TYPED_ROOT}src/${name}.abide`,
            file,
        )
        // 23.21 — a component stands under a lib directory, where a file is no page.
        const { server, client } = emitSource({
            ...placement(isPage ? 'index.abide' : `lib/${name}.abide`),
            file,
            answer: reads,
            invoked: !isPage,
        })
        modules[`${name}.abide`] = { server, client }
        if (isPage) pageClient = client
    }
    const dir = servedModules(modules)
    const { default: Component } = await import(`${dir}/Page.abide?component`)
    const html = new TextDecoder().decode(
        await renderDocument(
            Component,
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    // After the `<body …>` open tag, whatever attributes a page's own `<body>` wrote onto it (35.15).
    document.body.innerHTML = html.slice(
        html.indexOf('>', html.indexOf('<body')) + 1,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.abide?client`)
    return {
        html,
        client: pageClient,
        mount: () => {
            const scope = mount(pageRegion(document.body)) as Scope
            flushSync()
            return scope
        },
    }
}

// `renderPage`, mounted.
export async function mountPage(
    page: string,
    components: Record<string, string> = {},
): Promise<{ html: string; client: string; scope: Scope }> {
    const { html, client, mount } = await renderPage(page, components)
    return { html, client, scope: mount() }
}
