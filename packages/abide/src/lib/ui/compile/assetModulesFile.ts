import { resolve } from 'node:path'

/*
A single virtual ambient-declaration file injected into the shadow world so the
type-checker resolves bundler-handled asset imports instead of erroring "cannot
find module". Bun bundles a stylesheet import for its side effect and resolves a
static asset to its URL string; these declarations mirror that. One shared file
(not a per-component preamble) keeps the wildcard module patterns declared once,
which TypeScript requires. Used by both the check Program and the LSP service so
the editor and CLI agree.
*/
export function assetModulesFile(cwd: string): { path: string; content: string } {
    return {
        path: resolve(cwd, '__abide_assets__.d.ts'),
        content: [
            "declare module '*.css' {}",
            "declare module '*.scss' {}",
            "declare module '*.sass' {}",
            "declare module '*.less' {}",
            "declare module '*.svg' { const src: string; export default src }",
            "declare module '*.png' { const src: string; export default src }",
            "declare module '*.jpg' { const src: string; export default src }",
            "declare module '*.jpeg' { const src: string; export default src }",
            "declare module '*.gif' { const src: string; export default src }",
            "declare module '*.webp' { const src: string; export default src }",
            "declare module '*.avif' { const src: string; export default src }",
            "declare module '*.woff' { const src: string; export default src }",
            "declare module '*.woff2' { const src: string; export default src }",
            '',
        ].join('\n'),
    }
}
