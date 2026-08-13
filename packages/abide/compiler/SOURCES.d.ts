// The imports a checker cannot resolve on its own, because they are not TypeScript modules.
//
// `allowArbitraryExtensions` is what makes `./x.abide` resolve to the generated `.d.abide.ts`; a
// query suffix is not a file, so it needs an ambient declaration instead. See `plugin.ts` for why
// the text goes through the loader rather than being read at runtime.

declare module '*.abide?source' {
    const source: string
    export default source
}

// The same for a `.ts` module, and for the same reason: a reference page shows a file's own text, and
// a browser has no disk to read it from. `import x from './x.ts'` and `import SRC from './x.ts?source'`
// are two different modules out of one file — see the note in `plugin.ts` about keeping the query on
// the resolved path, which is what stops the bundler handing the second import the first one's module.
declare module '*.ts?source' {
    const source: string
    export default source
}

// `import './app.css'` — a stylesheet, reached by the component that needs it.
//
// A no-op on the server and an asset in the browser lane, so it has no shape either way: what the
// import DOES is put the file in the graph, and `abide start` links what the bundler wrote. Declared
// here because `allowArbitraryExtensions` resolves `./app.css` to an `app.d.css.ts` that nobody
// writes, and a checker with no declaration refuses a side-effect import outright.
// Empty on purpose: a side-effect import is the whole of what this is for, so there is no default to
// hand back and declaring one would typecheck `import styles from './app.css'` into an `undefined`.
declare module '*.css' {}
