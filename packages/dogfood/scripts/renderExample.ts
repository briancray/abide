// An EXAMPLE is a MANIFEST over files the docs app already holds: `examples/<name>.json` names
// the component that renders it and the files a reader is shown. The component is invoked INLINE
// on the page that embeds it — the example is the docs app running its own code, so there is no
// second app, no frame and no stand-in network between the reader and what the source says.
//
// This module renders the CARD around it: the caption, the slot the page puts the component in,
// and the file tabs. `{% example name %}` becomes this card for the site and the same files as
// fences for the markdown bundle.

import { escapeAttribute } from '@abide/abide'

import { ifPresent } from './ifPresent.ts'
import {
    displayPath,
    highlight,
    renderInline,
    sideOf,
} from './renderMarkdown.ts'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)
const APP_ROOT = new URL('../', import.meta.url)

type ExampleFile = { path: string; source: string }

// WHICH FILE A READER OPENS FIRST is the one the problem is solved in. That is the
// `.abide` file for almost every problem — the component is where an author starts, and
// the handler is what they reach back for — so the order is DERIVED from each file's
// seam rather than from how the manifest happens to list them. `about: 'server'` is
// the one exception, for an example whose problem IS a server problem (validating a
// body, authorizing a call), where the handler is the thing being read.
const SEAM_ORDER = {
    ui: ['abide', 'browser', 'server'],
    server: ['server', 'abide', 'browser'],
} as const

function orderedFiles(paths: string[], about: 'ui' | 'server'): string[] {
    const seams = SEAM_ORDER[about]
    // Stable, so two files on the same seam keep the order the manifest gave them.
    return [...paths].sort(
        (a, b) => seams.indexOf(sideOf(a)) - seams.indexOf(sideOf(b)),
    )
}

/** An `examples/<name>.json`. Only `about` is optional. */
export type Manifest = {
    title: string
    summary: string
    /** Paths from the app's root: every file the example is made of, and nothing else (40.4). */
    files: string[]
    /** THE COMPONENT THE CARD RENDERS, one of `files`. The page invokes it where the card sits. */
    render: string
    /**
     * WHICH OF THE FOUR APPS the pattern is drawn from.
     *
     * Per docs/BRAND.md, "The four apps an example is drawn from". Declared rather than inferred
     * from the words, because what the clause governs is a page's examples AGREEING, and prose
     * cannot be compared.
     */
    app: string
    /** Which seam the problem is about, and so which file opens first; `ui` when absent. */
    about?: 'ui' | 'server'
}

/** An example's manifest, refused when missing or when it renders a file it does not list. */
export async function readManifest(name: string): Promise<Manifest> {
    const manifest = await ifPresent<Manifest>(
        Bun.file(new URL(`${name}.json`, EXAMPLES_DIR)).json(),
    )
    if (manifest === undefined)
        throw new Error(`example ${name}: examples/${name}.json is missing`)
    if (!manifest.files.includes(manifest.render))
        throw new Error(
            `example ${name}: renders ${manifest.render}, which is not one of its files`,
        )
    return manifest
}

/**
 * The name the page imports the rendered component as.
 *
 * A component file is named after what it exports (CLAUDE.md), so the file's own name is the tag.
 */
export function componentOf(render: string): string {
    return render.slice(render.lastIndexOf('/') + 1, -'.abide'.length)
}

/** A file's text by its path from the docs app's root, or `undefined` where it is absent. */
export async function readSource(path: string): Promise<string | undefined> {
    return ifPresent(Bun.file(new URL(path, APP_ROOT)).text())
}

async function readFiles(
    name: string,
    paths: string[],
): Promise<ExampleFile[]> {
    const group: ExampleFile[] = []
    for (const path of paths) {
        const source = await readSource(path)
        if (source === undefined)
            throw new Error(`example ${name}: ${path} is missing`)
        group.push({ path, source })
    }
    return group
}

function renderFileGroup(files: ExampleFile[]): string {
    let tabs = ''
    let bodies = ''
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        if (!file) continue
        const selected = index === 0
        tabs += `<button role="tab" aria-selected="${selected}" data-side="${sideOf(file.path)}" data-file="${index}">${escapeAttribute(displayPath(file.path))}</button>`
        bodies += `<pre data-file="${index}"${selected ? '' : ' hidden'}><code>${highlight(file.source.trimEnd())}</code></pre>`
    }
    return `<div class="ex-files" role="tablist">${tabs}</div>${bodies}`
}

/**
 * The marker for where the page puts the example's component.
 *
 * A comment rather than markup, because the card is HTML the page writes into its template and
 * the component is a TAG there — `pageSource` swaps this for `<Name/>`, and a marker that
 * survived into the output would be a card with nothing in it.
 */
export function renderSlot(name: string): string {
    return `<!--render:${name}-->`
}

export type Example = {
    name: string
    html: string
    /** The component's path, which the page imports. */
    render: string
    /** The tag the page invokes the component as. */
    component: string
}

/** An example's card HTML, and the component the page imports and invokes inside it. */
export async function readExample(name: string): Promise<Example> {
    const manifest = await readManifest(name)
    const files = await readFiles(
        name,
        orderedFiles(manifest.files, manifest.about ?? 'ui'),
    )

    // THE RENDER IS NOT A FILE (40.5). It is the thing the example IS, so it sits above the
    // files and stays there — what they hold is what you consult ABOUT it.
    const html = `<figure class="example">
<figcaption><span class="ex-title">${renderInline(manifest.title)}</span><span class="ex-summary">${escapeAttribute(manifest.summary)}</span></figcaption>
<div class="ex-render">${renderSlot(name)}</div>
${renderFileGroup(files)}
</figure>`

    return {
        name,
        html,
        render: manifest.render,
        component: componentOf(manifest.render),
    }
}

/** The same files the tabs are built from, flattened for a reader who gets TEXT, not tabs. */
export async function exampleMarkdown(name: string): Promise<string> {
    const manifest = await readManifest(name)
    const files = await readFiles(
        name,
        orderedFiles(manifest.files, manifest.about ?? 'ui'),
    )

    let markdown = `**${manifest.title}** — ${manifest.summary}\n`
    for (const file of files) {
        // The extension IS the fence language for every file kind an example holds, so
        // the label reads exactly like a hand-written fence in `content/`.
        const language = file.path.slice(file.path.lastIndexOf('.') + 1)
        markdown += `\n\`\`\`${language} ${displayPath(file.path)}\n${file.source.trimEnd()}\n\`\`\`\n`
    }
    return markdown
}
