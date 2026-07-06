import { fileName } from './fileName.ts'

/*
Whether a module path is a router `layout.abide` — an EXACT leaf-filename match, the
one predicate every site shares. `endsWith('layout.abide')` is wrong: it also matches
`cardlayout.abide`, which the bundler's loader (exact match) compiles as a plain
component, so an `endsWith` site would hot-compile / fingerprint it as a layout and
diverge from the shipped bundle. Mirrors the loader so classification can't drift.
*/
export function isLayoutFile(path: string): boolean {
    return fileName(path) === 'layout.abide'
}
