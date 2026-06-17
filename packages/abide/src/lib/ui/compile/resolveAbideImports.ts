import { dirname, resolve } from 'node:path'
import ts from 'typescript'

/*
A module-name resolver shared by the shadow Program (check) and LanguageService
(LSP). A relative `./X.abide` import resolves directly to its virtual shadow
`./X.abide.ts` (the host serves shadow text for any `*.abide.ts` name), so
cross-component prop checking works. An aliased `.abide` (`$ui/X.abide`) falls
through to TypeScript's own resolver, which applies the tsconfig `paths` and —
because the host reports the shadow `.abide.ts` exists — lands on the same
shadow. Every other specifier (`abide/*`, `$server/*`, plain relative `.ts`,
asset modules covered by the ambient declarations) resolves through TypeScript
directly, exactly as for the real module.
*/
export function resolveAbideImports(
    options: ts.CompilerOptions,
    host: ts.ModuleResolutionHost,
): (moduleNames: string[], containingFile: string) => (ts.ResolvedModule | undefined)[] {
    return (moduleNames, containingFile) =>
        moduleNames.map((name) => {
            if (name.endsWith('.abide')) {
                const relative = resolve(dirname(containingFile), name)
                if (ts.sys.fileExists(relative)) {
                    return { resolvedFileName: `${relative}.ts`, extension: ts.Extension.Ts }
                }
            }
            return ts.resolveModuleName(name, containingFile, options, host).resolvedModule
        })
}
