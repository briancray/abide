// `import source from './x.abide?source'` — the file's own text.
//
// `allowArbitraryExtensions` is what makes `./x.abide` resolve to the generated `.d.abide.ts`; a
// query suffix is not a file, so it needs an ambient declaration instead. See `plugin.ts` for why
// the text goes through the loader rather than being read at runtime.

declare module '*.abide?source' {
    const source: string
    export default source
}
