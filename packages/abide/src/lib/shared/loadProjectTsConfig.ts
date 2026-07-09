import ts from 'typescript'

/*
Loads the project's tsconfig (for lib/paths/baseUrl/moduleResolution — so the
server graph resolves imports the same way the app does) and forces type-check-only
overrides: `noEmit` (never write) and `skipLibCheck` (the warm server program only
queries handler return types, never reports diagnostics, so lib checking is dead
cost). Falls back to permissive defaults when no tsconfig is found. Distinct from
`loadShadowTsConfig` (the UI shadow's loader) so the server side carries no ui import.
*/
export function loadProjectTsConfig(cwd: string): ts.ParsedCommandLine {
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
        },
    }
}
