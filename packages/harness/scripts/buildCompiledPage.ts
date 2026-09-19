// Builds ONE compiled `.abide` page into what a browser needs: the server's markup, and the
// client module bundled as an IIFE that mounts into it. This is the piece `abide build` does not
// do yet — there is no bundling step — so the browser arm makes it here rather than waiting.
//
// Its OTHER job is to be the hand-written arm's twin: both pages are built by this file, from the
// same shell, so a difference between them is the implementation and not the harness. CLAUDE.md:
// two arms running byte-identical source differed 4.5x because only one shipped a stylesheet.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdtemp/rm of its own
import { tmpdir } from 'node:os' // bun exposes no temp-directory helper of its own
import {
    emitClient,
    emitComponent,
    parseAbide,
    TypeSession,
} from 'abide/compiler'
import { render } from 'abide/server'

const REPO = new URL('../../../', import.meta.url).pathname
const SHELL = '<!doctype html><html><head></head><body></body></html>'

export type CompiledPage = { markup: string; script: string }

export async function buildCompiledPage(source: string): Promise<CompiledPage> {
    const session = await TypeSession.open(
        `${REPO}packages/abide/tsconfig.json`,
    )
    const scratch = mkdtempSync(`${REPO}.test-modules/page-`)
    try {
        const file = parseAbide(source)
        // The fixture path is what puts the shadow inside a project the checker has opened.
        const names = await session.reads(
            `${REPO}packages/abide/tests/fixtures/typed/src/browser.abide`,
            file,
        )
        writeFileSync(`${scratch}/Page.ts`, emitComponent(file, names))
        writeFileSync(`${scratch}/Page.client.ts`, emitClient(file, names))
        writeFileSync(
            `${scratch}/entry.ts`,
            // `flushSync` is exposed beside `mount` because a drain is batched to the end of a
            // TURN: a measured body that clicks and returns is measured before any binding has
            // run, and reports zero work for a page that did all of it a microtask later.
            // `dom.test.ts` states the same rule for the bun-side lane.
            //
            // `__LOOP_MOUNT__` does the SAME bindings over the SAME nodes with one binding site
            // executed n times instead of n sites executed once. The emitted mount is
            // straight-line, and the server bench found that shape costing ~6x what a loop costs
            // because code that runs once never gets warm. This is the arm that says whether the
            // client pays the same thing — and it is what `{#for}` emits by construction.
            [
                `import mount from './Page.client.ts'`,
                `import { flushSync, reactive, watch } from 'abide'`,
                `import { escapeless, setText } from 'abide/runtime'`,
                `const g = globalThis`,
                `g.__MOUNT__ = () => mount(document.body)`,
                `g.__MOUNT_INTO__ = (root) => mount(root)`,
                `g.__FLUSH__ = flushSync`,
                `g.__LOOP_MOUNT__ = (root) => {`,
                // THE VALUE IS MADE PER MOUNT, as the emitted one is: `let rows = reactive(...)`
                // lives inside the compiled mount, so each call starts with an empty reader list.
                // Hoisting it to module scope made every repetition add 3000 more readers to the
                // same cell and the arm reported 84 ms for what takes 7 — an O(n^2) fan-out that
                // read as a finding about emitted code shape.
                `    const spare = reactive([0])`,
                `    const cards = root.querySelectorAll('#list > article')`,
                `    for (let at = 0; at < cards.length; at += 1) {`,
                `        const card = cards[at]`,
                `        for (let k = 0; k < 3; k += 1) {`,
                `            const node = card.children[k].firstChild`,
                `            watch(() => setText(node, escapeless(spare()[0])))`,
                `        }`,
                `    }`,
                `}`,
                '',
            ].join('\n'),
        )

        const { default: Component } = await import(`${scratch}/Page.ts`)
        let markup = ''
        for await (const chunk of render(Component, SHELL))
            markup += new TextDecoder().decode(chunk)

        const built = await Bun.build({
            entrypoints: [`${scratch}/entry.ts`],
            format: 'iife',
            target: 'browser',
            minify: false,
        })
        if (!built.success)
            throw new AggregateError(
                built.logs,
                'the compiled page did not build',
            )

        return {
            markup: markup.slice(
                markup.indexOf('<body>') + '<body>'.length,
                markup.indexOf('</body>'),
            ),
            script: await (
                built.outputs[0] as { text(): Promise<string> }
            ).text(),
        }
    } finally {
        session.close()
        rmSync(scratch, { recursive: true, force: true })
    }
}

if (import.meta.main) {
    const page = await buildCompiledPage(
        await Bun.file(`${REPO}${Bun.argv[2] ?? ''}`).text(),
    )
    const out = mkdtempSync(`${tmpdir()}/abide-page-`)
    writeFileSync(`${out}/page.json`, JSON.stringify(page))
    console.log(`${out}/page.json`)
}
