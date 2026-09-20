import {
    type AbideFile,
    emitClient,
    emitComponent,
    parseAbide,
} from '#compiler'
import type { Read } from '#compiler/classifyRead.ts'
import { Lowering } from '#compiler/Lowering.ts'
import { projectShadow } from '#compiler/projectShadow.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { type Token, tokenise } from '#compiler/tokenise.ts'

// THE CHECKER DECIDES WHAT IS REACTIVE, so a test that means "`n` is a `Reactive` here" has to say
// so in a way the checker reads. `typed` declares every name it is given as one at module scope —
// `let n = reactive(undefined as any)` — unless the page already declares that name there, and
// hands back the file with its reads. Nothing about the answer is forged: the same session an app
// build opens is asked the same question.

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const PAGE = `${ROOT}src/typed.abide`

let session: TypeSession | undefined

export async function closeTyped(): Promise<void> {
    session?.close()
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
        prelude = `import { reactive } from 'abide'\n${prelude}`
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
    const tokens = tokenise(script)
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
    reads: Read[]
}> {
    const declared = declare(source, names)
    const file = parseAbide(declared.source)
    session ??= await TypeSession.open(`${ROOT}tsconfig.json`)
    return {
        source: declared.source,
        prelude: declared.prelude,
        file,
        reads: await session.reads(PAGE, file),
    }
}

// A `<script>` body lowered with `names` reactive, the declarations `typed` added cut back off.
export async function lower(
    script: string,
    names: Iterable<string> = [],
    used: Set<string> = new Set(),
): Promise<string> {
    const { prelude, file, reads } = await typed(
        `<script>${script}</script>`,
        names,
    )
    const lowering = new Lowering(file, reads)
    const lowered = lowering.scripts().slice(prelude.length)
    for (const name of lowering.used) used.add(name)
    return lowered
}

// The distinct names a set of reads lands on, sorted — what a test asserting WHICH names are
// reactive compares against.
export function namesRead(file: AbideFile, reads: readonly Read[]): string[] {
    const text = projectShadow(file).text
    const names = new Set<string>()
    for (const read of reads) names.add(text.slice(read.start, read.end))
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

// The client and server modules for a source with `names` reactive.
export async function clientOf(
    source: string,
    names: Iterable<string> = [],
): Promise<string> {
    const { file, reads } = await typed(source, names)
    return emitClient(file, reads)
}

export async function serverOf(
    source: string,
    names: Iterable<string> = [],
): Promise<string> {
    const { file, reads } = await typed(source, names)
    return emitComponent(file, reads)
}
