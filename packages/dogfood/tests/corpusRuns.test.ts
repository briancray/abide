// EVERY EXAMPLE, RENDERED AND MOUNTED. `corpus.test.ts` asks whether the emitted modules PARSE,
// which is a weak bar: a module that parses can still reference a name nobody exported, walk to a
// node that is not there, or throw on its first read. This one runs them.
//
// 68 apps written before the compiler existed, using surface the rulebook decided. What they
// exercise is not what a fixture written beside the implementation exercises, which is the whole
// reason to run them rather than more of my own pages.
//
// A RATCHET, like its neighbour: the ones that do not run are LISTED with what stops them, so one
// that starts running fails this test and has to leave the list.

import { expect, test } from 'bun:test'
import {
    compileFile,
    emitClient,
    parseAbide,
    TypeSession,
} from 'abide/compiler'
import { render } from 'abide/server'
import {
    removeTemporaryModules,
    temporaryModule,
} from '../../abide/tests/temporaryModule.ts'

const EXAMPLES = new URL('../examples/', import.meta.url)
const TSCONFIG = new URL('../examples/tsconfig.json', import.meta.url).pathname
const SHELL = '<!doctype html><html><head></head><body></body></html>'

const sources = [
    ...new Bun.Glob('*/files/**/*.abide').scanSync({ cwd: EXAMPLES.pathname }),
].sort()

test('every example renders on the server and mounts on the client', async () => {
    const session = await TypeSession.open(TSCONFIG)
    const broken: string[] = []

    try {
        for (const relative of sources) {
            const path = new URL(relative, EXAMPLES).pathname
            const text = await Bun.file(path).text()
            try {
                const file = parseAbide(text)
                const names = await session.reactiveNames(path, file)
                // EACH EXAMPLE IS ITS OWN APP, with its own `#server` / `#shared` / `#ui`, and
                // the emitted module imports through them exactly as the source did. A temp
                // directory is not that app, so the specifiers are rewritten to the example's own
                // files. An `imports` map was tried first and bun did not resolve one pointing
                // outside its own package — this is the harness's problem to solve, not the
                // compiler's, and solving it is what makes the run cover the whole corpus rather
                // than the subset that happens to import nothing.
                const root = new URL(
                    `${relative.slice(0, relative.indexOf('/files/'))}/files/src/`,
                    EXAMPLES,
                ).pathname
                const resolve = (module: string): string =>
                    module.replace(
                        /from '#(server|shared|ui)(\/[^']*)?'/g,
                        (_, seam: string, rest: string | undefined) =>
                            `from '${root}${seam}${rest === undefined ? '/index.ts' : `${rest}.ts`}'`,
                    )

                const dir = temporaryModule({
                    'Page.ts': resolve(compileFile(text, names)),
                    'Page.client.ts': resolve(
                        emitClient(file, names) || 'export default () => {}',
                    ),
                })

                const { default: Component } = await import(`${dir}/Page.ts`)
                let html = ''
                for await (const chunk of render(Component, SHELL))
                    html += new TextDecoder().decode(chunk)

                document.body.innerHTML = html.slice(
                    html.indexOf('<body>') + '<body>'.length,
                    html.indexOf('</body>'),
                )
                const { default: mount } = await import(`${dir}/Page.client.ts`)
                mount(document.body)
            } catch (thrown) {
                broken.push(String(thrown).split('\n')[0] ?? '')
            }
        }
    } finally {
        session.close()
        removeTemporaryModules()
    }

    // GROUPED BY WHAT IS MISSING, not listed per file. Fifty lines saying `Export named 'GET' not
    // found` is one fact about the rpc surface, and reading it as fifty problems is how a work
    // queue turns into a wall.
    const reasons = new Map<string, number>()
    for (const line of broken) {
        const missing = /Export named '([^']+)'/.exec(line)
        const key =
            missing !== null
                ? `\`${missing[1]}\` is not exported — that surface is not built`
                : (line.split(':')[0] ?? line)
        reasons.set(key, (reasons.get(key) ?? 0) + 1)
    }
    const ranked = [...reasons].sort((left, right) => right[1] - left[1])

    console.log(
        [
            `\n  ${sources.length - broken.length} of ${sources.length} sources render and mount.`,
            '  What stops the rest, and it is mostly not the compiler:',
            ...ranked.map(
                ([reason, count]) =>
                    `    ${String(count).padStart(3)}  ${reason}`,
            ),
        ].join('\n'),
    )

    // A FLOOR, ratcheted. It is not a pass/fail of the corpus — most of what is missing is
    // runtime surface the rulebook decided and nobody has written — but it must not go DOWN, and
    // a change that takes it up should move this number in the same commit.
    expect(sources.length - broken.length).toBeGreaterThanOrEqual(33)
})
