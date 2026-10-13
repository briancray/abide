// 34.24 — A PLAIN `.ts` IMPORTING A NAME A `.abide` EXPORTS IS TYPED BY TYPESCRIPT ITSELF, through
// what `abide check` writes to `.abide/types` and the `rootDirs` and `paths` the scaffold's tsconfig
// names. `bun check` is the reader here because it is the one that never sees abide's own checker.

import { afterAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { checkApp } from '#compiler/checkApp.ts'
import { BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const PAGE = `<script server>
import { GET } from '@abide/abide/server'

export const count = GET(() => 3)
</script>

<main>{await count()}</main>
`

// A `string` where the handler answers a `number`: typed, both spellings are an error, and untyped
// they would be `any` and pass.
const USE = `import { count } from '../page.abide'
import { count as aliased } from '#src/notes/page.abide'

export async function relative(): Promise<string> {
    return await count()
}
export async function alias(): Promise<string> {
    return await aliased()
}
`

function typedApp(): string {
    return `${temporaryModule({
        'app/package.json': JSON.stringify({
            name: 'typed',
            type: 'module',
            imports: { '#src/*': ['./src/*', './src/*.ts'] },
        }),
        'app/tsconfig.json': JSON.stringify({
            extends: '../../../tsconfig.base.json',
            compilerOptions: {
                rootDirs: ['.', '.abide/types'],
                paths: {
                    '#src/*': ['./src/*', './src/*.ts', './.abide/types/src/*'],
                },
            },
            include: ['src'],
        }),
        'app/src/notes/page.abide': PAGE,
        'app/src/notes/server/use.ts': USE,
    })}/app`
}

// THE REVERT: drop `writeTypes` from `checkApp`; `bun check` reports both imports as modules with no
// declarations rather than the two mistyped returns.
test('a plain .ts importing a handler from a .abide is typed by tsc — 34.24', async () => {
    const app = typedApp()
    await checkApp(`${app}/src`)
    const checked = await spawned(['bun', 'check', '--no-pretty', '-p', app])
    const errors = checked.stdout
        .split('\n')
        .filter((line) => line.includes('error TS'))
    expect(errors).toHaveLength(2)
    for (const error of errors)
        expect(error).toContain(
            "Type 'number' is not assignable to type 'string'",
        )

    // THE MIRROR FOLLOWS THE TREE: a `.abide` removed takes its types with it.
    await Bun.file(`${app}/src/notes/page.abide`).delete()
    await checkApp(`${app}/src`)
    expect(
        await Bun.file(`${app}/.abide/types/src/notes/page.abide.ts`).exists(),
    ).toBe(false)
}, 30_000)

// 34.24 — BEFORE ANY CHECK OR BUILD: `abide sync` is the scaffold's `prepare`, so a project is typed
// once it is installed. THE REVERT: make `sync` in `bin/abide.ts` answer 0 without `syncTypes`;
// `bun check` reports both imports as modules with no declarations.
test('abide sync alone types a plain .ts importing a .abide — 34.24', async () => {
    const app = typedApp()
    const synced = await spawned(['bun', BIN, 'sync', '--root', `${app}/src`])
    expect(synced.stdout).toContain('abide sync: 1 .abide file typed')
    const checked = await spawned(['bun', 'check', '--no-pretty', '-p', app])
    const errors = checked.stdout
        .split('\n')
        .filter((line) => line.includes('error TS'))
    expect(errors).toHaveLength(2)
    for (const error of errors)
        expect(error).toContain(
            "Type 'number' is not assignable to type 'string'",
        )
}, 30_000)

// 34.24 — A FILE WHOSE PROJECTION IS REFUSED (34.3) IS A FINDING, not the end of the run: `sync`
// names it and types the rest, and `abide check` reports it with the others. THE REVERT: let
// `projectShadow` throw out of `writeTypes`; `sync` aborts with the bare 34.3 message and
// `notes/page.abide` is never typed, and `checkApp` rejects rather than answering.
test('a refused projection is named, and the rest are typed and checked — 34.24, 34.3', async () => {
    const app = typedApp()
    await Bun.write(
        `${app}/src/awaits.abide`,
        '<script>await Promise.resolve()</script><p>x</p>\n',
    )
    const synced = await spawned(['bun', BIN, 'sync', '--root', `${app}/src`])
    expect(synced.exitCode).toBe(1)
    expect(synced.stderr).toContain('awaits.abide')
    expect(synced.stderr).toContain('34.3')
    expect(synced.stdout).toContain('abide sync: 1 .abide file typed')
    expect(
        await Bun.file(`${app}/.abide/types/src/notes/page.abide.ts`).exists(),
    ).toBe(true)
    const found = await checkApp(`${app}/src`)
    const refusals = found.filter((diagnosis) =>
        diagnosis.message.includes('34.3'),
    )
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.path).toEndWith('awaits.abide')
}, 30_000)

// 34.24 — THE SCAFFOLD'S INSTALL DOES NOT FAIL ON `sync`: a container installs from `package.json`
// before the source is copied in, where `sync` finds no app (38.26). THE REVERT: `prepare` as bare
// `abide sync`; the script exits 1, and so does `bun install`.
test('the scaffold installs where sync finds no app — 34.24, 38.26', async () => {
    const into = temporaryModule({ 'keep.txt': '' })
    expect(
        (await spawned(['bun', BIN, 'scaffold', 'boxed'], { cwd: into }))
            .exitCode,
    ).toBe(0)
    const app = `${into}/boxed`
    await spawned(['rm', '-rf', `${app}/src`])
    await spawned(['mkdir', '-p', `${app}/node_modules/.bin`])
    await spawned(['ln', '-s', BIN, `${app}/node_modules/.bin/abide`])
    const prepared = await spawned(['bun', 'run', 'prepare'], { cwd: app })
    expect(prepared.exitCode).toBe(0)
}, 30_000)
