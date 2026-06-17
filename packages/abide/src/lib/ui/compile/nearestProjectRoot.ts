import { dirname } from 'node:path'
import ts from 'typescript'

/*
The project root governing a `.abide` file: the directory of the nearest
`tsconfig.json` at or above it, or `fallback` when none is found. The LSP routes
each document to a shadow service rooted here, so a file is type-checked against
its own project's `paths`/`baseUrl`/strictness — the same tsconfig `abide check`
uses when run from that package. Without this, every file in a monorepo opened at
its root would be checked against the root tsconfig, and project-local path
aliases (`$server/*`, `$ui/*`) would fail to resolve.
*/
export function nearestProjectRoot(filePath: string, fallback: string): string {
    const configPath = ts.findConfigFile(dirname(filePath), ts.sys.fileExists, 'tsconfig.json')
    return configPath === undefined ? fallback : dirname(configPath)
}
