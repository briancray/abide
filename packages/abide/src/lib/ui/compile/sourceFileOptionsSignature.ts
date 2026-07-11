import ts from 'typescript'

/* The compiler-option fields that change how a source file parses or binds — the only inputs
   (besides the text) that make two parses of the same path differ, so the `cachedSourceFile`
   key folds them in to keep two projects with different targets/libs from sharing a file. */
export function sourceFileOptionsSignature(options: ts.CompilerOptions): string {
    return JSON.stringify([
        options.target,
        options.module,
        options.moduleDetection,
        options.jsx,
        options.jsxImportSource,
        options.useDefineForClassFields,
        options.alwaysStrict,
        options.strict,
        options.verbatimModuleSyntax,
        options.isolatedModules,
        options.lib,
    ])
}
