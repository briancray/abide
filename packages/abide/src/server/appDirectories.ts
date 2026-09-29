// WHERE AN APP'S OWN FILES STAND: the directory `ui/` sits under, and the one above it — `src/` and
// the package beside it. The app's `package.json` and `bunfig.toml` are found in the first that has one.
export function appDirectories(root: string): string[] {
    return [root, `${root}/..`]
}
