// 38.11 — A PAGE CHECKED UNDER A LINKED ROOT, as an editor opens a workspace reached through a
// symlink (`/tmp` is one on macOS). The resolver names a component by its REAL path, so a page kept
// under the link had its component's shadow written where its import never looks, and the checker
// answered it with the stand-in that takes anything. `abide lsp` makes the path real on its way in
// and spells it under the link again on its way out.
//
// IN A LANGUAGE SERVER OF ITS OWN because the miss shows on the first check a process makes: a
// checker opened after another in the same process has answered the page's import with the
// component's props either way, and so cannot tell the fix from its revert.

import { afterAll, expect, test } from 'bun:test'
import { symlinkSync, unlinkSync } from 'node:fs' // bun exposes no symlink of its own
import { checkSource } from '#compiler/checkApp.ts'
import { openChecker } from '#compiler/compileApp.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

afterAll(() => removeTemporaryModules())

const PAGE = `<script>
import Card from './lib/Card.abide'
</script>
<Card title={1}/>`

// THE REVERTS: hand `checkSource` the path as the editor spelled it (`placed` answering the given
// root); `title` takes anything and nothing is reported. Or answer a definition at its real path
// (`spelled` returning what it is given); the jump names a file the editor does not hold open.
test('a page opened through a symlinked root is held to its component props', async () => {
    const app = appFixture({
        'index.abide': PAGE,
        'lib/Card.abide': `<script>
import { props } from '@abide/abide'
const { title } = props<{ title: string }>()
</script>
<p>{title}</p>`,
    })
    const linked = `${app}-linked`
    symlinkSync(app, linked)
    const server = languageServer()
    try {
        const uri = Bun.pathToFileURL(`${linked}/index.abide`).href
        server.send({
            id: 1,
            method: 'initialize',
            params: { capabilities: {} },
        })
        await server.next((message) => message.id === 1)
        server.send({
            method: 'textDocument/didOpen',
            params: {
                textDocument: {
                    uri,
                    languageId: 'abide',
                    version: 1,
                    text: PAGE,
                },
            },
        })
        const published = (await server.next(
            (message) => message.method === 'textDocument/publishDiagnostics',
        )) as { params: { diagnostics: { code: number }[] } }
        expect(published.params.diagnostics.map(({ code }) => code)).toEqual([
            2322,
        ])
        server.send({
            id: 2,
            method: 'textDocument/definition',
            params: {
                textDocument: { uri },
                position: { line: 3, character: 2 },
            },
        })
        expect(await server.next((message) => message.id === 2)).toMatchObject({
            result: [
                {
                    uri: Bun.pathToFileURL(`${linked}/lib/Card.abide`).href,
                },
            ],
        })
    } finally {
        server.kill()
        unlinkSync(linked)
    }
}, 60_000)

type Message = { method?: string; id?: number; params?: unknown }

// `abide lsp` from the filesystem's root, as an editor starts it, with the protocol's framing.
function languageServer(): {
    send(message: object): void
    next(matches: (message: Message) => boolean): Promise<Message>
    kill(): void
} {
    const server = Bun.spawn(['bun', BIN, 'lsp'], {
        cwd: '/',
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const received: Message[] = []
    void (async () => {
        let pending = ''
        for await (const chunk of server.stdout) {
            pending += new TextDecoder().decode(chunk)
            for (;;) {
                const end = pending.indexOf('\r\n\r\n')
                if (end === -1) break
                const length = Number(
                    /Content-Length: (\d+)/.exec(pending)?.[1],
                )
                if (pending.length < end + 4 + length) break
                received.push(
                    JSON.parse(pending.slice(end + 4, end + 4 + length)),
                )
                pending = pending.slice(end + 4 + length)
            }
        }
    })()
    return {
        send(message) {
            const body = JSON.stringify({ jsonrpc: '2.0', ...message })
            server.stdin.write(
                `Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`,
            )
            server.stdin.flush()
        },
        async next(matches) {
            for (let turn = 0; turn < 600; turn += 1) {
                const at = received.findIndex(matches)
                if (at !== -1) return received.splice(at, 1)[0] as Message
                await Bun.sleep(50)
            }
            throw new Error(`no such message in ${JSON.stringify(received)}`)
        },
        kill: () => server.kill(),
    }
}

const READER = `<script server>
import { config } from '@abide/abide/server'

const retries: number = config().RETRIES
const wrong: string = config().RETRIES
</script>`

// 27.13 — A PAGE CHECKED ALONE IS TYPED BY DEFAULTS IT NEVER IMPORTED, as the whole app's check types
// it. THE REVERT: drop the scan for files filing `onConfig` from `checkSource`; `RETRIES` reads
// `unknown`, and 2 findings where 1 is due.
test('a page checked alone is typed by an onConfig it does not import — 27.13', async () => {
    const app = appFixture({
        'index.abide': READER,
        'settings/index.abide': `<script server>
import { onConfig } from '@abide/abide/server'

onConfig(() => ({ RETRIES: 3 }))
</script>`,
    })
    const checker = await openChecker(app)
    try {
        const found = await checkSource(checker, `${app}/index.abide`, READER)
        expect(found.map(({ line, code }) => ({ line, code }))).toEqual([
            { line: 5, code: 2322 },
        ])
    } finally {
        await checker.close()
    }
}, 60_000)

// 38.11 — THE SCAN FOR FILES FILING `onConfig` IS KEPT ON THE CHECKER until its watcher hears a move,
// so a check asked on every keystroke reads nothing on disk again. Asserted on the WORK: a file
// written with no move heard is not seen, and seen once `saw` is told. THE REVERT: lay the app out
// afresh in `checkSource` (`appLayout(root)` for `checker.layout()`); the second check finds the new
// file, 1 finding where 2 are due.
test('a kept checker re-reads the app only once a move is heard — 38.11', async () => {
    const app = appFixture({ 'index.abide': READER })
    const checker = await openChecker(app)
    const codes = async (): Promise<number[]> =>
        (await checkSource(checker, `${app}/index.abide`, READER)).map(
            (diagnosis) => diagnosis.code,
        )
    try {
        expect(await codes()).toHaveLength(2)
        const settings = `${app}/settings/index.abide`
        await Bun.write(
            settings,
            `<script server>
import { onConfig } from '@abide/abide/server'

onConfig(() => ({ RETRIES: 3 }))
</script>`,
        )
        expect(await codes()).toHaveLength(2)
        checker.saw(settings)
        expect(checker.current()).toBe(true)
        expect(await codes()).toHaveLength(1)
    } finally {
        await checker.close()
    }
}, 60_000)

// 30.26 — THE ROUTE TABLE `url` IS HELD TO IS KEPT ON THE CHECKER until its watcher hears a move, so
// a check asked on every keystroke walks and reads nothing on disk again. Asserted on the WORK: a
// page written with no move heard is not seen, and seen once `saw` is told. THE REVERT: lay the app
// out afresh in `checkSource` (`appLayout(root)` for `checker.layout()`); the second check sees the
// new page, 0 findings where 1 is due.
test('a kept checker re-walks the route table only once a move is heard — 30.26', async () => {
    const LINKER = `<script>
import { url } from '@abide/abide'

const later = url('/later')
</script>

<a href={later}>later</a>`
    const app = appFixture({ 'index.abide': LINKER })
    const checker = await openChecker(app)
    const codes = async (): Promise<number[]> =>
        (await checkSource(checker, `${app}/index.abide`, LINKER)).map(
            (diagnosis) => diagnosis.code,
        )
    try {
        expect(await codes()).toEqual([2345])
        const later = `${app}/later/index.abide`
        await Bun.write(later, '<p>later</p>')
        expect(await codes()).toEqual([2345])
        checker.saw(later)
        expect(checker.current()).toBe(true)
        expect(await codes()).toEqual([])
    } finally {
        await checker.close()
    }
}, 60_000)

// 38.34, 34.20 — WHAT THE TREE REFUSES OF AN OPEN FILE is published for it, as `abide check` reports
// it (38.33), off the layout the checker keeps — so it goes once the file is saved without what was
// refused and the move is heard. THE REVERT: leave `layout.refused` out of `checkSource`; the open
// file reads 0 refusals where 1 is due.
test('a tree refusal is a finding for the file it names, until a save clears it — 38.34, 34.20', async () => {
    const WIDGET = `<script server>
const answer = 42
</script>

<p>widget</p>`
    const app = appFixture({
        'index.abide': '<p>home</p>',
        'server/Widget.abide': WIDGET,
    })
    const checker = await openChecker(app)
    const widget = `${app}/server/Widget.abide`
    const refused = async (path: string, text: string): Promise<string[]> => {
        const said: string[] = []
        for (const diagnosis of await checkSource(checker, path, text))
            if (diagnosis.message.includes('34.20')) said.push(diagnosis.path)
        return said
    }
    try {
        expect(await refused(widget, WIDGET)).toEqual([widget])
        expect(await refused(`${app}/index.abide`, '<p>home</p>')).toEqual([])
        await Bun.write(widget, '<p>widget</p>')
        checker.saw(widget)
        expect(checker.current()).toBe(true)
        expect(await refused(widget, '<p>widget</p>')).toEqual([])
    } finally {
        await checker.close()
    }
}, 60_000)

// 38.34 — WHAT THE PARSER REFUSES OF A FILE IS ITS TEXT'S, and the text is the editor's: the layout's
// parse of the disk is not a tree refusal, so a saved file the parser refuses is published once,
// and an edit that fixes it clears it before the save. THE REVERT: keep the layout's parse refusals
// among `refused`; the saved file reads the one refusal twice, and the fixed text still reads it.
test('a file the parser refuses is refused once, as the editor holds it — 38.34', async () => {
    const BROKEN = '<p>{:finally}</p>'
    const app = appFixture({
        'index.abide': '<p>home</p>',
        'broken/index.abide': BROKEN,
    })
    const checker = await openChecker(app)
    const broken = `${app}/broken/index.abide`
    const said = async (text: string): Promise<string[]> => {
        const messages: string[] = []
        for (const diagnosis of await checkSource(checker, broken, text))
            messages.push(diagnosis.message)
        return messages
    }
    try {
        const saved = await said(BROKEN)
        expect(saved).toHaveLength(1)
        expect(saved[0]).toContain('32.56')
        expect(await said('<p>fixed</p>')).toEqual([])
    } finally {
        await checker.close()
    }
}, 60_000)
