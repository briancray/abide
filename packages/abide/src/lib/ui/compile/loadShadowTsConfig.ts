import ts from 'typescript'

/*
Loads the project's tsconfig (for lib/paths/baseUrl/strictness — the shadows must
type-check against the same world the app does), then forces the overrides the
shadow needs: `noUnusedLocals`/`noUnusedParameters` off because the shadow
legitimately declares scope bindings a template may not read, and `noEmit`/
`skipLibCheck` because it only ever type-checks. Falls back to permissive defaults
when no tsconfig is found. Shared by the check Program and the LSP LanguageService.
*/
export function loadShadowTsConfig(cwd: string): ts.ParsedCommandLine {
    const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json')
    const base = configPath
        ? ts.parseJsonConfigFileContent(
              ts.readConfigFile(configPath, ts.sys.readFile).config,
              ts.sys,
              cwd,
          )
        : { options: {}, fileNames: [], errors: [] }
    return {
        ...base,
        options: {
            ...base.options,
            noEmit: true,
            skipLibCheck: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
            allowUnreachableCode: true,
        },
    }
}
