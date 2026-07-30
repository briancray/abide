// IS THERE A DOM? — the other side predicate, named because it is not the same question as `isBrowser`.
//
// `isBrowser` asks whether a `window` exists. This asks whether a `document` does. In a real browser and
// on a real server they agree, and under `bun test` they DELIBERATELY DO NOT: `test/happydom.ts` installs
// happy-dom's globals and then deletes `window`, so the suite presents a DOM with no window. That is what
// makes the cross-tab `state.shared` tests possible at all (they need `document`/`BroadcastChannel`) while
// keeping every `isBrowser` gate on its server branch, which is the branch a server test wants.
//
// So the two predicates are not interchangeable and the choice is not stylistic:
//
//   - `isBrowser` — "am I running in a browser?" Gates SERVER-ONLY machinery: the AsyncLocalStorage
//     request scope, the shared cross-request cache, the bounded store.
//   - `hasDom`    — "is there a document to work with?" Gates DOM-shaped capability: whether
//     `state.shared` can keep a process-wide registry and sync it across tabs.
//
// `state.ts` had this one as a local `const isClient = typeof document !== 'undefined'` with a comment
// explaining the discriminator. Two spellings of "which side am I on" in one directory is how they come to
// be used interchangeably; naming the second question is cheaper than remembering which files may ask it.
//
// Computed once at module load — neither answer changes within a process.
export const hasDom = typeof document !== 'undefined'
