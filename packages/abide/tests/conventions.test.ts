// CLAUDE.md's rules had no gate, and they are the ones a session reads first and forgets by the
// third file. Not all of them are checkable — "a name is long enough when a reader who has not
// opened the callee can say what it returns" is a judgement and stays one — but a few are exact,
// and every one of those is load-bearing in a way that fails SILENTLY: an import that reads as free
// costs a module's whole union, a `node:` import that nobody justified quietly becomes the pattern,
// and a constants leaf that grew an import stops being a leaf without anything saying so.
//
// These pass trivially today, the framework being five files. That is the point of writing them
// now: the first file that violates one fails, rather than the fiftieth being found by reading.

import { expect, test } from 'bun:test'

const ABIDE = new URL('../', import.meta.url)

async function sources(
    root: URL,
    pattern = '**/*.ts',
): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = []
    for (const path of new Bun.Glob(pattern).scanSync({
        cwd: root.pathname,
        onlyFiles: true,
    })) {
        if (path.includes('node_modules')) continue
        out.push({ path, text: await Bun.file(new URL(path, root)).text() })
    }
    return out
}

// CLAUDE.md, "seams and imports": `abide` / `abide/runtime` / `abide/server` are what an APP
// resolves through, and a file inside this package reaching for one is asking a curated barrel for
// a name it could have taken from the module. It also builds a cycle the bundler has to break.
test('framework code imports by seam, never through its own public specifier', async () => {
    const offenders: string[] = []
    for (const { path, text } of await sources(ABIDE)) {
        if (path.startsWith('tests/')) continue
        for (const match of text.matchAll(/from '(abide(?:\/[\w-]+)?)'/g)) {
            offenders.push(`${path}: ${match[1]}`)
        }
    }
    expect(offenders).toEqual([])
})

// CLAUDE.md, "writing code": a `node:` import names the bun api it stands in for, in the comment.
// The rule is not "never" — it is that the reason is written down where the next reader meets it,
// so a stand-in cannot quietly become the house pattern.
test('every node: import names the bun api it stands in for', async () => {
    const bare: string[] = []
    for (const { path, text } of await sources(ABIDE)) {
        for (const line of text.split('\n')) {
            if (!/^import .* from 'node:/.test(line)) continue
            if (/\/\/\s*\S/.test(line)) continue
            bare.push(`${path}: ${line.trim()}`)
        }
    }
    expect(bare).toEqual([])
})

// CLAUDE.md, "seams and imports": a constant crossing a seam lives in a LEAF — its own UPPERCASE
// file with no imports of its own. A leaf that grows one stops being a leaf, and what that costs is
// paid by every module that took the constant: the import edge is priced by the module it lands on,
// so a leaf with a dependency drags that dependency onto every page that read one number.
test('a constants leaf has no imports of its own', async () => {
    const grown: string[] = []
    for (const root of [ABIDE, new URL('../../harness/', import.meta.url)]) {
        for (const { path, text } of await sources(root)) {
            const name = path.slice(path.lastIndexOf('/') + 1, -'.ts'.length)
            if (name !== name.toUpperCase() || !/^[A-Z][A-Z0-9_]*$/.test(name))
                continue
            if (/^import\s/m.test(text)) grown.push(`${path}`)
        }
    }
    expect(grown).toEqual([])
})

// CLAUDE.md, "writing code": a file is named after what it EXPORTS when it exports one thing, so a
// reader holding the import line knows which of the three it is without opening it. The framework's
// own addresses are the stated exception and are listed rather than inferred.
const ADDRESSES = new Set([
    'index',
    'app',
    'page',
    'layout',
    'error',
    'preload',
    'abide',
])

test('a file exporting one thing is named after what it exports', async () => {
    const misnamed: string[] = []
    for (const root of [ABIDE, new URL('../../harness/', import.meta.url)]) {
        for (const { path, text } of await sources(root)) {
            if (path.startsWith('tests/')) continue
            const name = path.slice(path.lastIndexOf('/') + 1, -'.ts'.length)
            if (ADDRESSES.has(name)) continue
            const exported = [
                ...text.matchAll(
                    /^export (?:const|function|class|type|interface) (\w+)/gm,
                ),
            ]
            if (exported.length !== 1) continue
            const only = exported[0]?.[1] ?? ''
            const screaming = /^[A-Z][A-Z0-9_]*$/.test(only)
            const title = /^[A-Z][a-zA-Z0-9]*$/.test(only)
            const expected = screaming ? only : title ? only : only
            if (name !== expected) misnamed.push(`${path}: exports ${only}`)
        }
    }
    expect(misnamed).toEqual([])
})
