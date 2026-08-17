// Where this app's own directories ARE, for the cases that read or spawn them.
//
// One leaf, because a path is the one thing a case cannot ask the app for: `harness/spawn` runs a
// binary in a directory and `deriveShapes` scans one, and WHICH directory is a fact about the app
// under test. It lived as `${import.meta.dir}/..` in twenty files, which is a rule that holds only
// while every one of them sits at the same depth — the move that put them under `tests/unit/` broke
// all twenty at once, silently in the ones that only made a directory to scan.
//
// Named after the SEAMS rather than after the tree, so a case says which substrate it is reaching
// into. The aliases cannot do this job: `#ui/pages` is a module specifier and these are filesystem
// paths handed to `Bun.file`, a glob or a child process.
//
// No trailing slashes. A caller that needs one adds it, and a joined `${PAGES}/x` reads the same way
// everywhere.

/** `packages/dogfood`. This file is at `src/tests/`, so two up. */
export const APP_ROOT = new URL('../..', import.meta.url).pathname

/** The workspace root, for the cases that assert something about the repo rather than about the app. */
export const REPO_ROOT = new URL('../../../..', import.meta.url).pathname

export const SERVER = `${APP_ROOT}/src/server`
export const PAGES = `${APP_ROOT}/src/ui/pages`

/** The suites — the demonstration, the test and the bench, which are one file each. */
export const DEMOS = `${APP_ROOT}/src/shared/demos`

/** The `.abide` files that are ARGUMENTS to a case, and the ladders' rungs. */
export const FIXTURES = `${DEMOS}/fixtures`

/** The type fixtures, including the tree under `invalid/` that is supposed to fail. */
export const TYPES = `${APP_ROOT}/src/tests/types`
