import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'

/*
Every fenced code block in the curated docs is compiled here, so a doc can't drift into
invalid or non-idiomatic abide — the class of bug that shipped a `.value` authoring surface,
a `props()` used without its import, and a `watch(cell, handler)` form that didn't type-check.
The block IS the fixture; there is no duplicated copy to keep in sync.

- `html`/`abide` blocks → type-checked through the real shadow checker (`abide check`'s path),
  under the strict app config, with loose stubs for the `$server`/`$ui` app-shell imports.
- `ts` blocks → type-checked as modules against the REAL `@abide/abide` surface + real `zod`,
  so a change to a server helper's signature (GET/POST/socket/json) breaks the doc here.

`text`/`sh`/`json`/unlabelled fences are prose or shell, not compilable, and are skipped.
See memory `docs-claims-must-trace-to-source`.
*/

const PACKAGE_ROOT = resolve(import.meta.dir, '..')
const ZOD_DIR = resolve(require.resolve('zod'), '..')
const DOCS = ['README.md', 'AGENTS.md']

type Block = { doc: string; lang: string; startLine: number; code: string }

/* Every ```lang … ``` fence in a markdown file, with its opening-fence line number. */
function fencedBlocks(doc: string): Block[] {
    const lines = readFileSync(resolve(PACKAGE_ROOT, doc), 'utf8').split('\n')
    const blocks: Block[] = []
    let open: { lang: string; startLine: number; body: string[] } | undefined
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        const fence = line.match(/^```(\w*)/)
        if (fence) {
            if (open === undefined) {
                open = { lang: fence[1] ?? '', startLine: index + 1, body: [] }
            } else {
                blocks.push({
                    doc,
                    lang: open.lang,
                    startLine: open.startLine,
                    code: open.body.join('\n'),
                })
                open = undefined
            }
            continue
        }
        if (open !== undefined) {
            open.body.push(line)
        }
    }
    return blocks
}

/* App-shell imports (`$server/*`, `$ui/*`) resolve through the real app's aliases, not the
   throwaway project — point them at the local stubs below so the block still resolves. */
function normalizeAliases(code: string): string {
    return code
        .replace("'$server/rpc/getMessages'", "'./getMessages.ts'")
        .replace("'$server/rpc/sendMessage'", "'./sendMessage.ts'")
        .replace("'$server/rpc/countToday'", "'./countToday.ts'")
        .replace("'$server/sockets/chat'", "'./chat.ts'")
        .replace("'$ui/Card.abide'", "'./Card.abide'")
        .replace("'$ui/Avatar.abide'", "'./Avatar.abide'")
        .replace("'$ui/Message.abide'", "'./Message.abide'")
        .replace("'../db.ts'", "'./db.ts'")
}

/* Loose stubs for the app-shell modules the `.abide` blocks import — the shapes they read, no
   framework typing (the RPC/socket types are covered by their own suites and by the ts blocks). */
const ABIDE_STUBS: Record<string, string> = {
    'getMessages.ts': `import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
type Message = { id: string; user: string; text: string }
// A real RemoteFunction so the bare call carries the smart-read probes (.pending / .error / …).
export const getMessages = GET((args: { limit: number }) => json([] as Message[]))
`,
    'sendMessage.ts': `export const sendMessage = (args: { text: string }): Promise<void> => Promise.resolve()
`,
    'countToday.ts': `import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
export const countToday = GET(() => json(0))
`,
    'chat.ts': `import { socket } from '@abide/abide/server/socket'
// The real Socket<T> so the client import carries the stream probes (.pending / .done / …).
export const chat = socket<{ user: string; text: string }>()
`,
    'Card.abide': `<script>
import { props } from '@abide/abide/ui/props'
import type { Snippet } from '@abide/abide/shared/snippet'
const { children } = props<{ children?: Snippet }>()
</script>
<div>{#if children}{children()}{/if}</div>
`,
    'Avatar.abide': `<script>
import { props } from '@abide/abide/ui/props'
const { alt } = props<{ alt: string }>()
</script>
<img alt={alt} />
`,
    'Message.abide': `<script>
import { props } from '@abide/abide/ui/props'
import type { Snippet } from '@abide/abide/shared/snippet'
const { message, children } = props<{ message: { id: string; user: string; text: string }; ondelete?: () => void; compact?: boolean; children?: Snippet }>()
</script>
<article>{message.text}{#if children}{children()}{/if}</article>
`,
}

/* A loose `../db.ts` for the ts blocks (`recentMessages`) — the RPC helpers under test are
   real; only the app's own data layer is stubbed. */
const DB_STUB = `export const recentMessages = (limit: number): Promise<Array<{ id: string; user: string; text: string }>> => Promise.resolve([])
`

/* A throwaway project holding `files`, with the real strict app config (`@abide/abide/tsconfig`)
   and the `@abide/abide` surface resolved to the real sources. */
function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'abide-docblock-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                target: 'ESNext',
                module: 'ESNext',
                moduleResolution: 'bundler',
                lib: ['ESNext', 'DOM', 'DOM.Iterable'],
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                allowImportingTsExtensions: true,
                noEmit: true,
                baseUrl: PACKAGE_ROOT,
                paths: { '@abide/abide/*': ['src/lib/*'] },
            },
        }),
    )
    for (const [name, contents] of Object.entries(files)) {
        const path = join(dir, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, contents)
    }
    return dir
}

/* Type-checks one `.ts` block as a module against the real `@abide/abide` surface + real `zod`. */
function tsBlockDiagnostics(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'abide-tsblock-'))
    const entry = join(dir, 'block.ts')
    writeFileSync(entry, normalizeAliases(code))
    writeFileSync(join(dir, 'db.ts'), DB_STUB)
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        types: [],
        baseUrl: PACKAGE_ROOT,
        paths: {
            '@abide/abide/*': ['src/lib/*'],
            zod: [ZOD_DIR],
            'zod/*': [`${ZOD_DIR}/*`],
        },
    }
    const program = ts.createProgram([entry], options)
    const source = program.getSourceFile(entry)!
    return [
        ...program.getSemanticDiagnostics(source),
        ...program.getSyntacticDiagnostics(source),
    ].map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

const blocks = DOCS.flatMap(fencedBlocks)
const abideBlocks = blocks.filter((block) => block.lang === 'html' || block.lang === 'abide')
const tsBlocks = blocks.filter((block) => block.lang === 'ts')

describe('doc code blocks compile', () => {
    test('the docs contain compilable code blocks to guard', () => {
        expect(abideBlocks.length).toBeGreaterThan(0)
        expect(tsBlocks.length).toBeGreaterThan(0)
    })

    for (const block of abideBlocks) {
        const label = `${block.doc}:${block.startLine} (${block.lang})`

        /* The idiom lock: an `.abide` block never reads/writes a cell via `.value` — that is the
           compiler's desugaring target, not the authoring surface. */
        test(`abide block ${label} uses the plain-variable cell idiom, never \`.value\``, () => {
            expect(block.code).not.toContain('.value')
        })

        test(`abide block ${label} type-checks with no diagnostics`, () => {
            const dir = project({
                'component.abide': normalizeAliases(block.code),
                ...ABIDE_STUBS,
            })
            const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter(
                (diagnostic) => diagnostic.file.endsWith('component.abide'),
            )
            expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([])
        })
    }

    for (const block of tsBlocks) {
        const label = `${block.doc}:${block.startLine} (ts)`
        test(`ts block ${label} type-checks with no diagnostics`, () => {
            expect(tsBlockDiagnostics(block.code)).toEqual([])
        })
    }
})
