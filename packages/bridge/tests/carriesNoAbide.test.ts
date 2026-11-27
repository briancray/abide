// THE BRIDGE CARRIES NO ABIDE AT RUN TIME: `bunx @abide/bridge` installs the bridge alone, so a value
// import of an `@abide/` package from what it ships is a module that machine does not have. abide is
// a workspace devDependency here, so nothing else fails on one — the typecheck and every test resolve
// it. A type import is erased and stays allowed. THE REVERT: import `messageOf` from
// `@abide/abide` in `src/bridge.ts`; this names `src/bridge.ts`.

import { expect, test } from 'bun:test'

test('nothing the bridge ships imports an @abide/ package', async () => {
    const root = new URL('..', import.meta.url).pathname
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const importing: string[] = []
    for await (const path of new Bun.Glob('{src,bin}/**/*.ts').scan(root)) {
        // A shebang is a line the transpiler does not read.
        const code = (await Bun.file(`${root}${path}`).text()).replace(
            /^#!.*\n/,
            '',
        )
        for (const { path: specifier } of transpiler.scanImports(code))
            if (specifier.startsWith('@abide/'))
                importing.push(`${path} → ${specifier}`)
    }
    expect(importing).toEqual([])
})
