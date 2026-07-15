import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import ts from 'typescript'

/*
Returns a public abide type straight from its shipped source, so the docs can
never drift from the real definition. `module` is a package export specifier
(e.g. `@abide/abide/server/agent`); `import.meta.resolve` maps it through the
package's `exports` map to the actual `.ts` the consumer imports, and the TS
compiler pulls out the exact `type`/`interface` declaration text for `name`.

Genuinely server-only: it reads shipped source off disk and runs the TypeScript
compiler, so unlike CodeBlock this can't collapse to an inline call — the client
build elides the handler, keeping the compiler out of the browser bundle. It hands
back the raw declaration text (not highlighted HTML); TypeDef runs the shared
`highlightCode` inline, exactly like CodeBlock. A bare smart read seeds the source
into the SSR snapshot so the client hydrates warm with no refetch, and every page
asking for the same (module, name) shares one cache entry.
*/
export const typeSource = POST(async ({ module, name }: { module: string; name: string }) => {
    // Only public abide surface — the specifier is resolved against the filesystem,
    // so fence it to the package instead of resolving an arbitrary path.
    if (!module.startsWith('@abide/')) {
        return error(400, `typeSource only reads @abide/* modules, got ${module}`)
    }
    const path = Bun.fileURLToPath(import.meta.resolve(module))
    const text = await Bun.file(path).text()
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

    // Find the top-level `type`/`interface` declaration named `name` and take its
    // exact text (getText excludes leading doc comments but keeps inner ones).
    let declaration: string | undefined
    for (const statement of source.statements) {
        const isTypeDeclaration =
            ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        if (isTypeDeclaration && statement.name.text === name) {
            declaration = statement.getText(source)
            break
        }
    }
    if (!declaration) {
        return error(404, `no exported type ${name} in ${module}`)
    }

    return json({ code: declaration })
})
