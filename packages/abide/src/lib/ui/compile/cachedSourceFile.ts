import ts from 'typescript'

/*
One parsed `ts.SourceFile` per (fileName, exact text, options signature), shared across
every `ts.Program` this process builds. `ts.createProgram` re-parses all ~90 default
`lib.*.d.ts` files (~3MB) plus every resolved dependency on each call — negligible for the
one-shot `abide check` CLI, but the LSP rebuilds a program per edit and the test suite builds
dozens over identical inputs. A `SourceFile` is a pure function of its text and the
parse/bind-affecting compiler options, so reuse is safe — the same reuse TS performs for the
source files it carries forward from an incremental `oldProgram`. Keying on the EXACT text
means any content change re-parses (never a stale AST); the `signature` keeps two projects
with different targets/libs from sharing a file; one entry per fileName bounds the cache to a
single program's footprint.
*/

type CacheEntry = { text: string; signature: string; sourceFile: ts.SourceFile }

const CACHE = new Map<string, CacheEntry>()

export function cachedSourceFile(
    fileName: string,
    text: string,
    languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
    signature: string,
    scriptKind?: ts.ScriptKind,
): ts.SourceFile {
    const existing = CACHE.get(fileName)
    if (existing && existing.text === text && existing.signature === signature) {
        return existing.sourceFile
    }
    const sourceFile = ts.createSourceFile(
        fileName,
        text,
        languageVersionOrOptions,
        true,
        scriptKind,
    )
    CACHE.set(fileName, { text, signature, sourceFile })
    return sourceFile
}
