#!/usr/bin/env bun
/*
What `@abide/abide` carries for a reader who has `node_modules` and nothing else — an agent in a
fresh app above all, which knows no abide it was not handed. Run by the package's `prepack`, so
what is published was read off this checkout:

- `docs/abide.md`, every docs page in reading order, fetched from the built docs app at the address
  that serves it, so the words keep the one home a page's `index.abide` gives them (RULEBOOK 38.106)
- `docs/RULEBOOK.md`, which every `RULEBOOK n.nn` a refusal ends with resolves in (38.105), and
  `docs/REGISTRY.md`, the names its clauses hang off

The three are copies, so `packages/abide/docs/` is ignored rather than checked in.
*/

const REPO = new URL('../', import.meta.url).pathname
const OUT = `${REPO}packages/abide/docs`
const BIN = `${REPO}packages/abide/bin/abide.ts`
const DOGFOOD = `${REPO}packages/dogfood`

async function run(command: string[]): Promise<void> {
    const child = Bun.spawn(command, {
        cwd: DOGFOOD,
        stdout: 'inherit',
        stderr: 'inherit',
    })
    if ((await child.exited) !== 0)
        throw new Error(`packDocs: ${command.join(' ')} failed`)
}

/** `/abide.md` as the built docs app answers it, on a port the OS picks. */
async function documentation(): Promise<string> {
    // The workspace's own bin by path: `abide` on PATH is a global link at best, and a clean
    // checkout has none.
    await run([
        'bun',
        BIN,
        'build',
        '--root',
        `${DOGFOOD}/src`,
        '--out',
        `${DOGFOOD}/.abide`,
    ])
    const server = Bun.spawn(
        [
            'bun',
            BIN,
            'start',
            '--root',
            `${DOGFOOD}/src`,
            '--out',
            `${DOGFOOD}/.abide`,
            '--port',
            '0',
        ],
        { cwd: DOGFOOD, stdout: 'pipe', stderr: 'inherit' },
    )
    try {
        let printed = ''
        for await (const chunk of server.stdout) {
            printed += new TextDecoder().decode(chunk)
            const address = /http:\/\/[^\s]+/.exec(printed)
            if (address === null) continue
            const answer = await fetch(
                new URL('/abide.md', new URL(address[0]).origin),
            )
            if (!answer.ok)
                throw new Error(`packDocs: /abide.md answered ${answer.status}`)
            return await answer.text()
        }
        throw new Error(`packDocs: the docs app printed no address: ${printed}`)
    } finally {
        server.kill()
    }
}

await Bun.write(`${OUT}/abide.md`, await documentation())
for (const name of ['RULEBOOK.md', 'REGISTRY.md'])
    await Bun.write(
        `${OUT}/${name}`,
        await Bun.file(`${REPO}docs/${name}`).text(),
    )
console.log(`packDocs: abide.md, RULEBOOK.md and REGISTRY.md -> ${OUT}`)
