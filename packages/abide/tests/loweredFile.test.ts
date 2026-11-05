// 38.39, 38.116, 38.117 — WHAT AN EDITOR ASKS OF A `.abide`, asked of the lowering its check
// registered (`LoweredFile`) directly rather than through `abide lsp`'s stdio: the hover, the
// references a rename edits, and the completions markup offers. The protocol around them — the
// handshake, the ranges, a shorthand's edit, the queue — is `serveLanguage.test.ts`'s.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { checkSource, lowerApp } from '#compiler/checkApp.ts'
import { type AppChecker, openChecker } from '#compiler/compileApp.ts'
import { offsetOf } from '#compiler/lineOf.ts'
import {
    completionAt,
    type LoweredFile,
    type References,
} from '#compiler/LoweredFile.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// 38.39 — a row's bindings, named in the block's head.
const ROWS = `<script>
const paths = ['a', 'b']
</script>

{#for path, index of paths}<p>{path}{index}</p>{/for}`

const BADGE = `<script>
import { props } from '@abide/abide'

const { tone, size } = props<{ tone: string; size?: number }>()
</script>

<p>{tone}{size}</p>`

const TAGS = `<script>
import Badge from '../lib/Badge.abide'
</script>

{#if true}<Badge tone="x"/>{/if}`

// 38.116 — a prop passed by a tag, and a component closed by a tag of its own.
const PANEL = `<script>
import { props } from '@abide/abide'

const { heading } = props<{ heading: string }>()
</script>

<h2>{heading}</h2>`

const PANELS = `<script>
import Panel from '../lib/Panel.abide'
</script>

<Panel heading="a"></Panel>
<Panel heading={'b'}/>`

const ELSEWHERE = `<script>
import Panel from '../lib/Panel.abide'
</script>

<Panel heading="c"></Panel>`

let app = ''
let checker: AppChecker

beforeAll(async () => {
    app = appFixture({
        'rows/index.abide': ROWS,
        'lib/Badge.abide': BADGE,
        'tags/index.abide': TAGS,
        'lib/Panel.abide': PANEL,
        'panels/index.abide': PANELS,
        'elsewhere/index.abide': ELSEWHERE,
    })
    checker = await openChecker(app)
})

afterAll(async () => {
    await checker.close()
    removeTemporaryModules()
})

/** The `.abide` at `relative` below the app, checked as `text` holds it, and the lowering it left. */
async function lowered(relative: string, text: string): Promise<LoweredFile> {
    const path = `${checker.root}/${relative}`
    await checkSource(checker, path, text)
    const lowering = checker.session.lowered(path)
    if (lowering === undefined) throw new Error(`${relative} was not lowered`)
    return lowering
}

/** The offset at 0-based `line` and `character` of `text`, as an editor sends a position. */
function at(text: string, line: number, character: number): number {
    return offsetOf(text, { line, character })
}

/**
 * Each file's occurrences, by its path below the app, as 0-based `line:character` — with the side
 * of a shorthand a rename renames — sorted.
 */
function placesIn(found: References | undefined): Record<string, string[]> {
    const byFile: Record<string, string[]> = {}
    for (const place of found?.occurrences ?? []) {
        const file = place.path.slice(checker.root.length + 1)
        const places = byFile[file] ?? []
        places.push(
            `${place.start.line - 1}:${place.start.column - 1}${place.shorthand === undefined ? '' : ` ${place.shorthand}`}`,
        )
        byFile[file] = places
    }
    for (const places of Object.values(byFile)) places.sort()
    return byFile
}

// A LOWERING ANSWERS ABOUT THE TEXT IT WAS MADE OF, and nothing at an offset into another: the
// editor's text moved under it, and an offset into the new text is somewhere else in the old.
// THE REVERT: drop the text test from `LoweredFile.askedAt`; the edited text's offset is asked of
// the old lowering and answers about whatever stood there.
test('a lowering answers only about the text it lowered — 38.39', async () => {
    const lowering = await lowered('rows/index.abide', ROWS)
    const offset = ROWS.indexOf('paths')
    expect((await lowering.inspect(ROWS, offset))?.signature).toBe(
        'const paths: string[]',
    )
    const edited = `${ROWS}\n`
    expect(await lowering.inspect(edited, offset)).toBeUndefined()
    expect(await lowering.references(edited, offset)).toBeUndefined()
}, 60_000)

// 38.39 — A `{#for}`'s ITEM AND INDEX HOVER AS THE BINDINGS THEY ARE, where the head names them.
// THE REVERT: write them into the projection as scaffolding (`for (const ${node.item} of …`); both
// are answered `undefined`.
test("a {#for}'s item and index hover in its head — 38.39", async () => {
    const lowering = await lowered('rows/index.abide', ROWS)
    const head = ROWS.indexOf('{#for')
    const hover = async (name: string): Promise<string | undefined> =>
        (await lowering.inspect(ROWS, ROWS.indexOf(name, head) + 1))?.signature
    expect(await hover('path,')).toBe('const path: string')
    expect(await hover('index')).toBe('const index: number')
}, 60_000)

// 38.116 — A PROP IS RENAMED WHERE A TAG PASSES IT, in every page that does, from the prop's side and
// from the attribute's. THE REVERT: write a component's attribute keys as scaffolding again
// (`JSON.stringify(key)` in `projectShadow`'s invocation); the declaration's side renames Panel alone,
// and a rename asked at an attribute answers nothing. Or ask no place again where the checked module
// copies the props type twice (`LoweredFile.references`); asked at the attribute, the shorthand
// binding is left out.
test("a prop's references reach every tag passing it — 38.116", async () => {
    const panel = await lowered('lib/Panel.abide', PANEL)
    const panels = await lowered('panels/index.abide', PANELS)
    // A page nobody opened passes it too, and is lowered as `abide lsp` lowers it for references.
    await lowerApp(checker, (path) =>
        path.endsWith('lib/Panel.abide')
            ? PANEL
            : path.endsWith('panels/index.abide')
              ? PANELS
              : undefined,
    )
    const lines = PANEL.split('\n')
    const declared = lines.findIndex((text) =>
        text.startsWith('const { heading'),
    )
    const declaration = lines[declared] as string
    const passing = PANELS.split('\n')
    const open = passing.findIndex((text) =>
        text.startsWith('<Panel heading="a"'),
    )
    const expected = {
        'lib/Panel.abide': [
            `${declared}:8 property`,
            `${declared}:${declaration.lastIndexOf('heading')}`,
        ].sort(),
        'panels/index.abide': [`${open}:7`, `${open + 1}:7`],
        'elsewhere/index.abide': ['4:7'],
    }
    expect(
        placesIn(
            await panel.references(
                PANEL,
                at(PANEL, declared, declaration.lastIndexOf('heading') + 1),
            ),
        ),
    ).toEqual(expected)
    expect(
        placesIn(await panels.references(PANELS, at(PANELS, open + 1, 8))),
    ).toEqual(expected)
}, 60_000)

// 38.116 — A COMPONENT IS REFERENCED AT A CLOSE TAG OF ITS OWN as at its open tag, asked at either,
// and a self-closing tag is the one place. THE REVERT: drop the close tag's read from
// `projectShadow`'s invocation; the close tags are left out, and asking at one answers nothing.
test('a component is referenced at its close tags too — 38.116', async () => {
    const panels = await lowered('panels/index.abide', PANELS)
    await lowerApp(checker, (path) =>
        path.endsWith('panels/index.abide') ? PANELS : undefined,
    )
    const passing = PANELS.split('\n')
    const imported = passing.findIndex((text) =>
        text.startsWith('import Panel'),
    )
    const open = passing.findIndex((text) =>
        text.startsWith('<Panel heading="a"'),
    )
    const closeAt = (passing[open] as string).indexOf('</Panel>') + 2
    // A default import's references are every importer's, as the checker answers them.
    const elsewhere = ELSEWHERE.split('\n')
    const elsewhereOpen = elsewhere.length - 1
    const expected = {
        'panels/index.abide': [
            `${imported}:7`,
            `${open}:1`,
            `${open}:${closeAt}`,
            `${open + 1}:1`,
        ].sort(),
        'elsewhere/index.abide': [
            '1:7',
            `${elsewhereOpen}:1`,
            `${elsewhereOpen}:${(elsewhere[elsewhereOpen] as string).indexOf('</Panel>') + 2}`,
        ],
    }
    expect(
        placesIn(await panels.references(PANELS, at(PANELS, imported, 8))),
    ).toEqual(expected)
    expect(
        placesIn(
            await panels.references(PANELS, at(PANELS, open, closeAt + 1)),
        ),
    ).toEqual(expected)
}, 60_000)

// 38.117 — MARKUP OFFERS WHAT MARKUP TAKES: the blocks the parser reads after `{#`, the arms and the
// close of the block still open after `{:` and `{/`, the components in scope after `<`, and a
// component's props not yet written inside its tag — asked of the last lowering, because the tag
// being typed is text the parser refuses. THE REVERT: drop the `templateContext` arm of
// `completionAt`; every one of these is answered `undefined`.
test('markup completes blocks, component tags and their props — 38.117', async () => {
    const lowering = await lowered('tags/index.abide', TAGS)
    const labelsAt = async (text: string): Promise<string[]> => {
        const found = await completionAt(lowering, text, text.length)
        return (found?.entries ?? []).map((entry) => entry.name).sort()
    }
    const head = TAGS.slice(0, TAGS.indexOf('{#if'))
    expect(await labelsAt(`${head}{#`)).toEqual([
        'component',
        'for',
        'if',
        'try',
    ])
    expect(await labelsAt(`${head}{#try}x{:`)).toEqual(['catch', 'finally'])
    expect(await labelsAt(`${head}{#if true}<p>x</p>{/`)).toEqual(['if'])
    expect(await labelsAt(`${head}<`)).toEqual(['Badge'])
    expect(await labelsAt(`${head}<Badge tone="x" `)).toEqual(['size'])
}, 60_000)
