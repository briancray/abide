/**
 * The paths below `directory` that `pattern` matches, or none for a directory that is not there.
 *
 * A missing directory is the common case rather than an error: a build has no `client/` or
 * `public/` until it writes one. Narrowed to that one code because a
 * directory that exists and cannot be read is a different fault and must not read as an empty one.
 */
export function namesUnder(directory: string, pattern = '**/*'): string[] {
    try {
        return [...new Bun.Glob(pattern).scanSync({ cwd: directory })]
    } catch (thrown) {
        if ((thrown as { code?: unknown }).code !== 'ENOENT') throw thrown
        return []
    }
}
