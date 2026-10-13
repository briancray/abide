// WHERE THE APP IS, WHEN NOBODY SAID. `abide scaffold ledger; cd ledger; abide dev` is the flow
// the documentation teaches (content/reference/cli.md) and `--root ./src` is what an app's own
// scripts write, so the two have to mean the same directory — and a command run somewhere that
// is NOT an app has to say so.
//
// THE REVERT: default `--root` to `process.cwd()`. `abide build` at a repo root then compiles
// every `.abide` in every package against a package.json with no seams in it, and the second
// test here reports a build that succeeded over eighty-five pages whose imports cannot resolve.

import { afterAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

afterAll(removeTemporaryModules)

const PAGE = `<head><title>Home</title></head>

<main id="home"><h1>Home</h1></main>`

// An app laid out the way a scaffold leaves one: the package at the top, the source under `src`.
function scaffolded(): string {
    return temporaryModule({
        'src/index.abide': PAGE,
        'package.json': JSON.stringify({
            name: 'cli-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
    })
}

test('an app is found at src/ where the command is run — 38.25, 38.27', async () => {
    const app = scaffolded()
    const built = await spawned(['bun', BIN, 'build'], { cwd: app })
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)

    // BESIDE THE APP, which is the other half of saying nothing: a build whose output lands
    // wherever the shell happened to stand is one `abide start` cannot find twice running.
    expect(await Bun.file(`${app}/.abide/compilation.json`).exists()).toBe(true)
    // THE ENTRY UNDER THE NAME THE MANIFEST GIVES IT, which a build hashes (38.5).
    const manifest = (await Bun.file(`${app}/.abide/manifest.json`).json()) as {
        entry: string
    }
    expect(
        await Bun.file(`${app}/.abide/client/${manifest.entry}`).exists(),
    ).toBe(true)
})

test('an app is found where the command is run, when ui/ is right there — 38.25', async () => {
    const app = scaffolded()
    const built = await spawned(['bun', BIN, 'build'], { cwd: `${app}/src` })
    expect(built.exitCode).toBe(0)
    // `dirname(root)` again, and the root here IS `src` — so the build goes beside it rather
    // than inside the tree it compiled.
    expect(await Bun.file(`${app}/.abide/compilation.json`).exists()).toBe(true)
})

test('a directory with no app is a refusal naming where it looked — 38.26', async () => {
    const nowhere = temporaryModule({ 'readme.md': 'nothing to build here\n' })
    const built = await spawned(['bun', BIN, 'build'], { cwd: nowhere })
    expect(built.exitCode).toBe(1)
    const said = built.stderr
    expect(said).toContain('no app here')
    expect(said).toContain(nowhere)
    expect(said).toContain('--root')
})

test('asking for help is a success and an unknown command is not — 38.12', async () => {
    for (const asked of [['help'], ['-h'], ['--help']]) {
        const helped = await spawned(['bun', BIN, ...asked])
        expect(helped.exitCode).toBe(0)
        expect(helped.stdout).toContain('abide <command>')
    }
    // GENERATED FROM THE COMMAND LIST the dispatch reads, so every command the registry names is in
    // the help — and a command the dispatch reaches, rather than 'unknown'. THE REVERT: drop a row
    // from `COMMANDS`; its registry name goes missing from the help.
    const said = (await spawned(['bun', BIN, '--help'])).stdout
    const registry = await Bun.file(
        new URL('../../../docs/REGISTRY.md', import.meta.url),
    ).text()
    const named = [...registry.matchAll(/^\| `abide (\w+)/gm)].map(
        (match) => match[1],
    )
    expect(named.length).toBeGreaterThan(10)
    for (const command of named) expect(said).toContain(`  ${command}`)

    const unknown = await spawned(['bun', BIN, 'frobnicate'])
    expect(unknown.exitCode).toBe(1)
    expect(unknown.stderr).toContain("unknown command 'frobnicate'")
})
