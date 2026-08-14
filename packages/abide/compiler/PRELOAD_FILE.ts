// Where `preload.ts` is, as a path a `--preload` can be handed.
//
// Its own module because the alternative is the caller counting `../` from wherever it happens to
// live: `abide run` spelled this `../../compiler/preload.ts` from `cli/internal/`, which is a seam
// crossing the repo's own grep cannot see — it is a `new URL`, not an import — and a file moved
// inside `compiler/` would have broken the spawn with bun's error about a path rather than abide's.
//
// Not `preload.ts` itself, and not `plugin.ts`: both REGISTER the loader when imported, and the one
// caller that wants this is spawning a child precisely so the registration happens over there.

/** The `bunfig.toml` preload, reached as a file: the plugin registration, and nothing else. */
export const PRELOAD_FILE = Bun.fileURLToPath(new URL('./preload.ts', import.meta.url))
