import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { HttpError } from '@abide/abide/shared/HttpError'
import ts from 'typescript'
import { getHighlighter } from '../getHighlighter.ts'

/*
Renders a public abide type straight from its shipped source, so the docs can
never drift from the real definition. `module` is a package export specifier
(e.g. `@abide/abide/server/agent`); `import.meta.resolve` maps it through the
package's `exports` map to the actual `.ts` the consumer imports, and the TS
compiler pulls out the exact `type`/`interface` declaration text for `name`.

Server-only, exactly like highlightCode: the client build elides this handler,
so neither the TypeScript compiler nor shiki reaches the browser bundle. A
CodeBlock-style bare smart read seeds the highlighted HTML into the SSR snapshot,
so the client hydrates warm with no refetch, and every page asking for the same
(module, name) shares one cache entry.
*/
export const typeSource = POST(async ({ module, name }: { module: string; name: string }) => {
    // Only public abide surface — the specifier is resolved against the filesystem,
    // so fence it to the package instead of resolving an arbitrary path.
    if (!module.startsWith('@abide/')) {
        throw new HttpError(400, `typeSource only reads @abide/* modules, got ${module}`)
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
        throw new HttpError(404, `no exported type ${name} in ${module}`)
    }

    const highlighter = await getHighlighter()
    const html = highlighter.codeToHtml(declaration, { lang: 'typescript', theme: 'github-light' })
    return json({ html })
})
