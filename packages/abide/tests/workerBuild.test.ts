// 55 — A WORKER FILE THROUGH `abide build` AND `abide start`: the browser's bundle holds a thread's
// entry for each worker file a page reaches and none other, and a page's stand-ins name it; a server
// started from the build runs the rest.
//
// THE REVERT: build every worker file for the browser rather than the ones a page reaches —
// `scores.worker.ts` imports a server file, so the build fails on 16.29 and every test below with it.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { buildDirectory, buildFiles } from '#server/appBuild.ts'

import { appFixture, buildApp, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let served: { app: string; base: string; stop: () => void }

beforeAll(async () => {
    served = await serveApp({
        'index.abide': `<script>
import { doubled } from '#src/lib/doubled.worker.ts'

const answer = computed(() => doubled(21))
</script>

<main id="answer">{answer}</main>`,
        'lib/doubled.worker.ts':
            'export async function doubled(value: number): Promise<number> {\n    return value * 2\n}\n',
        'lib/SECRET.server.ts': "export const SECRET = 'held on the server'\n",
        'lib/scores.worker.ts': `import { SECRET } from './SECRET.server.ts'

export async function* scores(): AsyncGenerator<string> {
    yield Bun.isMainThread ? 'main' : 'thread'
    yield SECRET
}
`,
        'getScores.handler.ts': `import { GET } from '@abide/abide/server'

import { scores } from '#src/lib/scores.worker.ts'

export default GET(async () => {
    const read: string[] = []
    for await (const score of scores()) read.push(score)
    return read
})
`,
    })
})

afterAll(() => {
    served?.stop()
    removeTemporaryModules()
})

test('the browser bundle holds the worker file a page reaches and none other, and its page names it — 55.1, 55.13', async () => {
    const { client } = buildFiles(buildDirectory(served.app))
    const names = [...new Bun.Glob('*.js').scanSync(client)]
    const threads = names.filter((name) => name.includes('.worker-'))
    expect(threads).toHaveLength(1)
    expect(threads[0]).toStartWith('doubled.worker-')
    let named = false
    for (const name of names)
        if (
            name !== threads[0] &&
            (await Bun.file(`${client}/${name}`).text()).includes(
                threads[0] as string,
            )
        )
            named = true
    expect(named).toBe(true)
})

test('a server started from the build runs a worker file in a thread of its own — 55.1, 55.5', async () => {
    const answered = await fetch(`${served.base}/getScores`)
    expect(await answered.json()).toEqual(['thread', 'held on the server'])
})

test('a worker file exporting anything but an async function stops the build — 55.3', async () => {
    const app = appFixture({
        'index.abide': '<main></main>',
        'lib/answer.worker.ts': 'export const answer = async () => 42\n',
    })
    const built = await buildApp(app)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('lib/answer.worker.ts exports answer')
    expect(built.stderr).toContain('RULEBOOK 55.3')
})
