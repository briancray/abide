import { expect, test } from 'bun:test'

import { Glob } from 'bun'
import { SyntaxKind } from 'typescript/unstable/ast'

import { tokenize } from '../../abide/src/compiler/tokenize.ts'
import { docsPages, fencesOf } from './docsPages.ts'

// 40.14 — AN EXAMPLE IS CAPTIONED WITH ITS SIDE: one of BRAND's four side words, which is what colors
// the spine. An ADDRESS a reader cannot open is a claim: a page's Tests derive their captions from a
// file the build reads, and a hand-written fence captioned with a path derives nothing. A fence with
// no language — a shell command, a tree — has no side, and carries no caption. THE REVERT: caption a
// `ts` fence of `/reactive/watch` "watch.ts", or "#server/watch.ts", and it is named.
const SIDES = new Set(['browser', 'server', 'shared', 'abide'])

test('every example fence is captioned with the side its code runs on', async () => {
    const unsided: string[] = []
    for (const page of await docsPages())
        for (const fence of fencesOf(page))
            if (
                fence.language === ''
                    ? fence.caption !== ''
                    : !SIDES.has(fence.caption)
            )
                unsided.push(
                    `${page.route}: ${fence.language || '(none)'} "${fence.caption}"`,
                )
    expect(unsided).toEqual([])
})

// 40.34 — AN EXAMPLE CALLS ONLY WHAT IT NAMES: a call to `track(…)` the fence never imports nor
// declares leaves the reader asking whether `track` is the subject's or the app's. A name is
// DECLARED where it appears anywhere in the fence but as a callee — an import, a binding, a
// parameter, a method's shorthand, `{#component Name(…)}` — so the check reads tokens and never parses, and a name only
// ever called is the candidate. A global is whatever this process has on `globalThis`, which the
// DOM preload makes a browser's and `bun test` makes its own. THE REVERT: write
// `onclose: (reason) => track('archive-notice', { reason })` in `/headless/toasts` and
// `track` is named.
const NOT_A_CALL = new Set([
    'if',
    'for',
    'while',
    'switch',
    'catch',
    'function',
    'return',
    'typeof',
    'await',
    'import',
    'super',
    'async',
])

/**
 * Whether the parameter list opening at `open` is followed by a body — a method written in
 * shorthand, `save() {` or `async *run(messages) {`, declares its name rather than calls it.
 */
function opensBody(tokens: ReturnType<typeof tokenize>, open: number): boolean {
    let depth = 0
    for (let at = open; at < tokens.length; at += 1) {
        const kind = (tokens[at] as (typeof tokens)[number]).kind
        if (kind === SyntaxKind.OpenParenToken) depth += 1
        else if (kind === SyntaxKind.CloseParenToken && --depth === 0) {
            return tokens[at + 1]?.kind === SyntaxKind.OpenBraceToken
        }
    }
    return false
}

/** Each name `code` calls and never names otherwise. */
function calledUndeclared(code: string): string[] {
    const called = new Set<string>()
    const named = new Set<string>()
    const tokens = tokenize(code.replace(/<style\b[\s\S]*?<\/style>/g, ''))
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as (typeof tokens)[number]
        // `type`, `async`, `of` and their kind scan as keywords, and are names wherever one is called.
        if (
            token.kind !== SyntaxKind.Identifier &&
            (token.kind < SyntaxKind.FirstContextualKeyword ||
                token.kind > SyntaxKind.LastContextualKeyword)
        )
            continue
        const before = tokens[at - 1]
        if (
            before?.kind === SyntaxKind.DotToken ||
            before?.kind === SyntaxKind.QuestionDotToken
        )
            continue
        const isCallee =
            tokens[at + 1]?.kind === SyntaxKind.OpenParenToken &&
            before?.kind !== SyntaxKind.FunctionKeyword &&
            before?.kind !== SyntaxKind.AsteriskToken &&
            before?.text !== '#component' &&
            !opensBody(tokens, at + 1)
        ;(isCallee ? called : named).add(token.text)
    }
    const undeclared: string[] = []
    for (const name of called)
        if (!named.has(name) && !NOT_A_CALL.has(name) && !(name in globalThis))
            undeclared.push(name)
    return undeclared
}

const SCRIPTS = new Set(['ts', 'js', 'abide'])

test('every example calls only names its fence imports or declares, or a global', async () => {
    const unnamed: string[] = []
    for (const page of await docsPages())
        for (const fence of fencesOf(page)) {
            if (!SCRIPTS.has(fence.language)) continue
            const names = calledUndeclared(fence.code)
            if (names.length > 0)
                unnamed.push(`${page.route}: ${names.join(', ')}`)
        }
    expect(unnamed).toEqual([])
})

// 40.35 — AN EXAMPLE IMPORTS WHAT THE APP HAS: a relative import is the example app's, and one naming
// a file the CRM never had teaches a function nobody can open. A fence has no address (40.14), so a
// path is matched by its FILE NAME against every file of the app, and the name it imports against
// what one of them exports — a `.abide` exports its component as its default. A name the CRM does not
// have is declared in the fence, where the reader sees it is the example's own. THE REVERT: import
// `track` from `'../lib/analytics.ts'` in `/headless/toasts` and it is named.
const CRM = new URL('../examples/crm/', import.meta.url).pathname

/** Every file of the example app, by file name. */
async function appFilesByName(): Promise<Map<string, string[]>> {
    const byName = new Map<string, string[]>()
    for await (const file of new Glob('{src,e2e,tests}/**/*.{ts,abide}').scan({
        cwd: CRM,
    })) {
        const name = file.slice(file.lastIndexOf('/') + 1)
        const files = byName.get(name) ?? []
        files.push(file)
        byName.set(name, files)
    }
    return byName
}

/** Whether `source` exports `name`, `default` being the default export. */
function exportsName(file: string, source: string, name: string): boolean {
    if (name === 'default')
        return file.endsWith('.abide') || /\bexport default\b/.test(source)
    return (
        new RegExp(
            `\\bexport\\s+(async\\s+)?(const|let|function\\*?|class|type|interface)\\s+${name}\\b`,
        ).test(source) ||
        new RegExp(`\\bexport\\s+(type\\s+)?\\{[^}]*\\b${name}\\b`).test(source)
    )
}

const RELATIVE_IMPORT =
    /\bimport\s+(?:type\s+)?([\w$]+)?\s*,?\s*(\{[^}]*\})?\s*from\s*'(\.{1,2}\/[^']+)'/g

test("every example's relative import names a file of the example app and a name it exports", async () => {
    const byName = await appFilesByName()
    const sources = new Map<string, string>()
    const invented: string[] = []
    for (const page of await docsPages())
        for (const fence of fencesOf(page))
            for (const match of fence.code.matchAll(RELATIVE_IMPORT)) {
                const path = match[3] as string
                const names: string[] = []
                if (match[1] !== undefined) names.push('default')
                const local = match[1] ?? ''
                if (match[2] !== undefined)
                    for (const part of match[2].slice(1, -1).split(',')) {
                        const name = part
                            .trim()
                            .replace(/^type\s+/, '')
                            .split(/\s+as\s+/)[0] as string
                        if (name !== '') names.push(name)
                    }
                const files =
                    byName.get(path.slice(path.lastIndexOf('/') + 1)) ?? []
                for (const name of names) {
                    let found = false
                    for (const file of files) {
                        let source = sources.get(file)
                        if (source === undefined) {
                            source = await Bun.file(`${CRM}${file}`).text()
                            sources.set(file, source)
                        }
                        if (exportsName(file, source, name)) found = true
                    }
                    if (!found)
                        invented.push(
                            `${page.route}: ${name === 'default' ? `${local} (default)` : name} from ${path}`,
                        )
                }
            }
    expect(invented).toEqual([])
})

const DOCS = new URL('../src/', import.meta.url).pathname

// 40.35 — AND AN EXAMPLE KEPT AS A FILE UNDER ITS PAGE'S `lib` (40.14) is held to it too: each relative
// import names a file of the example app and a name it exports, or a server file beside it that its
// page shows as the example's `server` — the one stand-in an example may carry. THE REVERT: read
// only `<Code>` fences, as this file did before; a lib example importing a file the CRM never had
// passes, `[]` where its line is due.
test("every lib example's relative import names a file of the example app, or a server file its page shows", async () => {
    const byName = await appFilesByName()
    const invented: string[] = []
    for await (const file of new Glob('**/lib/*.abide').scan({ cwd: DOCS })) {
        // The docs app's own components, not examples.
        if (file.startsWith('lib/')) continue
        const directory = file.slice(0, file.lastIndexOf('/'))
        const page = `${directory.slice(0, directory.lastIndexOf('/'))}/index.abide`
        const pageSource = await Bun.file(`${DOCS}${page}`)
            .text()
            .catch(() => '')
        const code = await Bun.file(`${DOCS}${file}`).text()
        for (const match of code.matchAll(RELATIVE_IMPORT)) {
            const path = match[3] as string
            if (path.startsWith('./') && path.endsWith('.server.ts')) {
                const beside = `${directory}/${path.slice(2)}`
                if (pageSource.includes(`server="${beside}"`)) continue
            }
            const name = path.slice(path.lastIndexOf('/') + 1)
            // `#src/…` and the docs app's own aliases are not relative, and a sibling `.abide` is
            // another example of the same page.
            if (name.endsWith('.abide') && path.startsWith('./')) continue
            if ((byName.get(name) ?? []).length === 0)
                invented.push(`${file}: ${path}`)
        }
    }
    expect(invented).toEqual([])
})
