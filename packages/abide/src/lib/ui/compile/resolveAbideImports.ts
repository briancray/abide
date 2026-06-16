import { dirname, resolve } from 'node:path'
import ts from 'typescript'

/*
A module-name resolver shared by the shadow Program (check) and LanguageService
(LSP). A `./X.abide` import resolves to its virtual shadow `./X.abide.ts` (the
host serves shadow text for any `*.abide.ts` name), so cross-component prop
checking works. Every other specifier — `abide/*`, `$server/*`, plain
relative `.ts` — falls through to TypeScript's own resolver against the real
filesystem; the containing shadow lives at the source's directory, so relative
and tsconfig-`paths` resolution behave exactly as for the real module.
*/
export function resolveAbideImports(
    options: ts.CompilerOptions,
    host: ts.ModuleResolutionHost,
): (moduleNames: string[], containingFile: string) => (ts.ResolvedModule | undefined)[] {
    return (moduleNames, containingFile) =>
        moduleNames.map((name) => {
            if (name.endsWith('.abide')) {
                const target = resolve(dirname(containingFile), name)
                return ts.sys.fileExists(target)
                    ? { resolvedFileName: `${target}.ts`, extension: ts.Extension.Ts }
                    : undefined
            }
            return ts.resolveModuleName(name, containingFile, options, host).resolvedModule
        })
}
