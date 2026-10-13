/**
 * The directories an app's own files stand in: `root`, and the one above it.
 *
 * `root` is the app's root — `src/` — and the one above it is the package beside
 * it. The app's `package.json` and `bunfig.toml` are found in the first that has one.
 */
export function appDirectories(root: string): string[] {
    return [root, `${root}/..`]
}
