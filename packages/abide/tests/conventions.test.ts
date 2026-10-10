// CLAUDE.md's rules had no gate, and they are the ones a session reads first and forgets by the
// third file. Not all of them are checkable — "a name is long enough when a reader who has not
// opened the callee can say what it returns" is a judgement and stays one — but a few are exact,
// and every one of those is load-bearing in a way that fails SILENTLY: an import that reads as free
// costs a module's whole union, a `node:` import that nobody justified quietly becomes the pattern,
// and a constants leaf that grew an import stops being a leaf without anything saying so.
//
// A CHECK HERE IS A LINE-LEVEL READING, not a parse, so each one names the spellings it reads and a
// spelling it does not is a hole in it rather than a pass.

import { expect, test } from 'bun:test'
import {
    CITATION,
    rulebookClauses,
} from '../../harness/scripts/rulebookClauses.ts'

const ABIDE = new URL('../', import.meta.url)
const PACKAGES = new URL('../../', import.meta.url)

// What `buildPages.ts` writes into the docs app from `content/` — gitignored, rebuilt by every
// `bun run build`, and named after the page it renders rather than by anyone choosing a name.
const GENERATED = ['dogfood/src/ui/pages/', 'dogfood/src/ui/public/']

async function sources(
    root: URL,
    pattern = '**/*.ts',
): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = []
    for (const path of new Bun.Glob(pattern).scanSync({
        cwd: Bun.fileURLToPath(root),
        onlyFiles: true,
    })) {
        if (path.includes('node_modules')) continue
        if (GENERATED.some((prefix) => path.startsWith(prefix))) continue
        out.push({ path, text: await Bun.file(new URL(path, root)).text() })
    }
    return out
}

// Every package's own source, relative to `packages/`: the framework (its tests are its own), the
// harness, the docs app's source and build scripts, and the bridge. The dogfood's playwright
// specs are left out — they run on node, under rules this file does not hold them to.
const AUTHORED = [
    'abide/**/*.ts',
    'harness/**/*.ts',
    'dogfood/src/**/*.ts',
    'dogfood/scripts/**/*.ts',
    'bridge/**/*.ts',
]

async function authored(
    extension = 'ts',
): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = []
    for (const pattern of AUTHORED)
        out.push(
            ...(await sources(PACKAGES, pattern.replace(/ts$/, extension))),
        )
    return out
}

const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/

// CLAUDE.md, "seams and imports": `@abide/abide` / `@abide/abide/runtime` / `@abide/abide/server` are what an APP
// resolves through, and a file inside this package reaching for one is asking a curated barrel for
// a name it could have taken from the module. It also builds a cycle the bundler has to break.
// THREE SPELLINGS reach a specifier — `from '…'`, `import('…')` and the bare side-effect
// `import '…'` — and the last two were not read until the third was the only one checked.
// THE REVERT: an `await import('@abide/abide/server')` in any src file is named here.
const SELF_IMPORT =
    /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)'(@abide\/abide(?:\/[\w-]+)?)'/gm

test('framework code imports by seam, never through its own public specifier', async () => {
    const offenders: string[] = []
    for (const { path, text } of await sources(ABIDE)) {
        // THE STARTER `abide scaffold` COPIES IS AN APP'S CODE, and resolves abide as an app does.
        if (path.startsWith('tests/') || path.startsWith('scaffold/')) continue
        for (const match of text.matchAll(SELF_IMPORT)) {
            offenders.push(`${path}: ${match[1]}`)
        }
    }
    expect(offenders).toEqual([])
})

// CLAUDE.md, "checks": A TEST NEVER WAITS ON A CHILD SYNCHRONOUSLY. A `bun test --parallel` worker can
// lose a child's exit, and a synchronous wait then spins for good where no timeout can reach it —
// the gate hangs and reports nothing. `spawned` from `harness/gate` awaits with a deadline instead.
// `execSync` and `execFileSync` are the same wait spelled by `node:child_process`. The dogfood's
// playwright specs (`dogfood/e2e`) run on node, outside `bun test`, and are not in the globs.
// THE REVERT: write one `Bun.spawn[S]ync(` into any test; it is named here, and an
// `exec[S]ync(` or `execFile[S]ync(` is too.
test('no test waits on a child process synchronously', async () => {
    const offenders: string[] = []
    for (const pattern of [
        'abide/tests/**/*.ts',
        'harness/tests/**/*.ts',
        'harness/src/**/*.ts',
        'harness/scripts/**/*.ts',
        'dogfood/tests/**/*.ts',
    ])
        for (const { path, text } of await sources(PACKAGES, pattern))
            for (const line of text.split('\n'))
                if (
                    /\b(?:spawn|exec|execFile)[S]ync\(/.test(line) &&
                    !COMMENT_LINE.test(line)
                )
                    offenders.push(`${path}: ${line.trim()}`)
    expect(offenders).toEqual([])
})

// CLAUDE.md, "writing code": a `node:` import names the bun api it stands in for, in the comment.
// The rule is not "never" — it is that the reason is written down where the next reader meets it,
// so a stand-in cannot quietly become the house pattern.
// THREE SPELLINGS reach a `node:` module: `from 'node:…'` — on the import's own line or, for one
// broken over several, on its closing `} from` — `require('node:…')` and `import('node:…')`. The
// comment sits on the line naming the module or on the statement's first line.
// A string holding import text (a compiler test's input) is not an import, so the static spelling
// is read only where a statement starts.
// THE REVERT: an `import {` broken over lines with no comment on its `} from 'node:path'` is named
// here, and the single-line reading this replaced passed it — as it passes the five
// `require('node:fs')` in `tests/cli*.test.ts` this one found.
const NODE_MODULE =
    /^\s*(?:import|export)\b[^'"`]*\bfrom\s*'node:|^\s*\}\s*from\s*'node:|\b(?:require|import)\s*\(\s*'node:/
const JUSTIFIED = /\/\/\s*\S/

test('every node: import names the bun api it stands in for', async () => {
    const bare: string[] = []
    for (const { path, text } of await sources(ABIDE)) {
        const lines = text.split('\n')
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? ''
            if (!NODE_MODULE.test(line) || COMMENT_LINE.test(line)) continue
            if (JUSTIFIED.test(line)) continue
            // A `} from 'node:…'` closes an import that opened lines above it.
            let opening = index
            if (/^\s*\}/.test(line))
                while (
                    opening > 0 &&
                    !/^\s*(?:import|export)\b/.test(lines[opening] ?? '')
                )
                    opening -= 1
            if (opening !== index && JUSTIFIED.test(lines[opening] ?? ''))
                continue
            bare.push(`${path}:${index + 1}: ${line.trim()}`)
        }
    }
    expect(bare).toEqual([])
})

// A `URL`'s `pathname` is PERCENT-ENCODED: under a directory with a space in its name it reads
// `/x%20y/`, a path no file sits at, and what read through it is silently missed rather than
// refused — a handler dropped from the manifest, a lint that switches itself off. A path on disk
// is `Bun.fileURLToPath`. A `pathname` inside a template literal is code the compiler EMITS, where
// it is a URL rather than a path, and is not read here.
// THE REVERT: `new URL('./x', import.meta.url).pathname` in any src file is named here.
const URL_AS_PATH = /new URL\([^)]*import\.meta\.url\s*\)\s*\.pathname/

test("a module finds its files by path, never by a URL's pathname", async () => {
    const encoded: string[] = []
    for (const pattern of ['src/**/*.ts', 'bin/**/*.ts'])
        for (const { path, text } of await sources(ABIDE, pattern)) {
            const lines = text.split('\n')
            for (let index = 0; index < lines.length; index += 1) {
                const line = lines[index] ?? ''
                const found = URL_AS_PATH.exec(line)
                if (found === null || COMMENT_LINE.test(line)) continue
                if (line.slice(0, found.index).includes('`')) continue
                encoded.push(`${path}:${index + 1}: ${line.trim()}`)
            }
        }
    expect(encoded).toEqual([])
})

// CLAUDE.md, "seams and imports": a constant crossing a seam lives in a LEAF — its own UPPERCASE
// file with no imports of its own. A leaf that grows one stops being a leaf, and what that costs is
// paid by every module that took the constant: the import edge is priced by the module it lands on,
// so a leaf with a dependency drags that dependency onto every page that read one number.
// A RE-EXPORT is an import edge spelled `export … from`, and a dynamic `import(…)` is one too.
// `import type` IS NOT: it leaves no edge in the emitted module, which is what lets a leaf name
// the shape of what it holds.
// THE REVERT: an `export { X } from './x'` in any UPPERCASE leaf is named here, on one line or
// several; an `import type` in the same leaf is not.
const EDGE =
    /^import(?!\s+type\b)\s|^export(?!\s+type\b)[^;=()]*?\bfrom\s*['"]|\bimport\s*\(/m

test('a constants leaf has no imports of its own', async () => {
    const grown: string[] = []
    for (const { path, text } of await authored()) {
        const name = path.slice(path.lastIndexOf('/') + 1, -'.ts'.length)
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue
        if (EDGE.test(text)) grown.push(path)
    }
    expect(grown).toEqual([])
})

// CLAUDE.md, "writing code": a file is named after what it EXPORTS when it exports one thing, so a
// reader holding the import line knows which of the three it is without opening it. The framework's
// own addresses are the stated exception and are listed rather than inferred: a file the framework
// finds BY NAME (`page`, `layout`, `error`, `preload`, `app`), a barrel (`index`), and the CLI's
// own entry (`bin/abide.ts`). A docs app's `rpc/` module is an address too — its path is the
// route's, and what it exports is the verb the client calls.
// EVERY EXPORT SPELLING COUNTS, `export function*`, `enum`, `let`, `default` and `export { … }`
// among them: a reading blind to one sees a file exporting two things as exporting the other one.
// THE REVERT: a file exporting only `function* notItsName` is named here, and so is one exporting
// only an `enum` or an `export { a as notItsName }`.
const ADDRESSES = new Set([
    'index',
    'app',
    'page',
    'layout',
    'error',
    'preload',
    'abide',
])

const DECLARED =
    /^export (?:default )?(?:declare )?(?:async )?(?:abstract )?(?:const enum|const|let|var|function\*?|class|type|interface|enum) (\w+)/gm
const LISTED = /^export (?:type )?\{([^}]*)\}/gm

/**
 * The names a module exports, as far as a line-level reading can tell — `undefined` where it
 * cannot (an `export *`, an anonymous default), which the rule then has nothing to say about.
 */
function exportedNames(text: string): string[] | undefined {
    if (/^export \*/m.test(text)) return undefined
    if (/^export default (?!(?:async )?(?:function|class)\b)/m.test(text))
        return undefined
    const names: string[] = []
    for (const declared of text.matchAll(DECLARED))
        names.push(declared[1] ?? '')
    for (const listed of text.matchAll(LISTED))
        for (const entry of (listed[1] ?? '').split(',')) {
            const name = entry
                .trim()
                .split(/\s+as\s+/)
                .pop()
                ?.replace(/^type\s+/, '')
            if (name) names.push(name)
        }
    return names
}

test('a file exporting one thing is named after what it exports', async () => {
    const misnamed: string[] = []
    for (const { path, text } of await authored()) {
        if (/^\w+\/tests\//.test(path)) continue
        if (path.startsWith('dogfood/src/server/rpc/')) continue
        const name = path.slice(path.lastIndexOf('/') + 1, -'.ts'.length)
        if (ADDRESSES.has(name)) continue
        const exported = exportedNames(text)
        if (exported?.length !== 1) continue
        if (name !== exported[0])
            misnamed.push(`${path}: exports ${exported[0]}`)
    }
    expect(misnamed).toEqual([])
})

// The same rule for a component: a `.abide` file's one export is its default, the component, and
// it is TitleCase. The addresses are the three a router finds by name — `routePattern.ts`'s
// `FileKind`.
// THE REVERT: a `lowerCase.abide` anywhere in the authored source is named here.
const ROUTED = new Set(['page', 'layout', 'error'])

test('a component file is named in TitleCase', async () => {
    const misnamed: string[] = []
    for (const { path } of await authored('abide')) {
        const name = path.slice(path.lastIndexOf('/') + 1, -'.abide'.length)
        if (ROUTED.has(name)) continue
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) misnamed.push(path)
    }
    expect(misnamed).toEqual([])
})

// CLAUDE.md, "documents": the clauses are what stops one rule being decided twice by two sessions
// that never met, and the join between them and the code is a number in a comment. The docs gate
// already holds REGISTRY and BRAND to citations that resolve; the framework's own comments were
// the third citing document and had no gate at all. Four had gone stale unnoticed — three naming
// a clause that had moved one number, and one naming a section that was never written.
//
// WHAT THIS CANNOT CATCH is the whole of an amendment: a citation that still RESOLVES while what
// it meant moved. That stays a rule rather than a check, and re-reading every hit is what an
// amendment costs.
//
// A MEASUREMENT IS TOLD FROM A CITATION BY ITS UNIT, and that is why every number in these
// comments carries one. `2.39 -> 1.86 ns` reads as two clause numbers to anything that only sees
// the digits, so the unit goes on both ends rather than on the last — the alternative is a
// heuristic over arrows and ranges that is wrong in one direction or the other.
//
// `%` IS NOT WORD-FINAL. It was written into the alternation behind a `\b` with the rest,
// which can never hold after a non-word character — so `0.7% floor` read as a citation of
// clause 0.7 and this gate caught its own author writing one.
//
// THE REVERT: putting `3.19` back on `Keyed.ts:52` reports
// `src/shared/reactive/Keyed.ts:52: 3.19` against an empty list. Reverting one of the
// off-by-one citations instead reports NOTHING — `1.7` is a live clause again, carrying a
// different rule — which is this gate's own blind spot demonstrated on itself.
const UNIT = /^\s*(?:(?:ns|µs|ms|s|x)\b|%)/

test('every clause a framework comment cites exists', async () => {
    const rulebook = await Bun.file(
        new URL('../../../docs/RULEBOOK.md', import.meta.url),
    ).text()
    const ids = new Set<string>()
    for (const { id } of rulebookClauses(rulebook)) ids.add(id)
    expect(ids.size).toBeGreaterThan(100)

    const dangling: string[] = []
    for (const { path, text } of await sources(new URL('src/', ABIDE))) {
        const lines = text.split('\n')
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? ''
            if (!line.trimStart().startsWith('//')) continue
            for (const cited of line.matchAll(CITATION)) {
                const id = cited[1] ?? ''
                const after = line.slice(
                    (cited.index ?? 0) + (cited[0]?.length ?? 0),
                )
                if (UNIT.test(after) || ids.has(id)) continue
                dangling.push(`src/${path}:${index + 1}: ${id}`)
            }
        }
    }
    expect(dangling).toEqual([])
})
