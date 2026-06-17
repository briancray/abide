import { Glob } from 'bun'

/*
Scans `cwd` for files matching `pattern` and returns their request paths as
a Set, mapping each relative file path to a root-relative URL via `keyFor`.
Used to snapshot the on-disk asset trees (the `public/` files, the `_app`
precompressed `.gz` siblings) once at boot so the request path is a Set
lookup instead of a filesystem stat.

A missing directory makes scan throw ENOENT — swallowed to an empty Set so
the caller just falls through. This scan-and-catch is also the reliable
directory existence test: `Bun.file(dir).exists()` returns false for a
directory, so guarding the scan with it silently yields an empty Set.
*/
export async function globToPathSet(
    cwd: string,
    pattern: string,
    keyFor: (file: string) => string,
    options?: { dot?: boolean },
): Promise<Set<string>> {
    try {
        const files = await Array.fromAsync(
            new Glob(pattern).scan({ cwd, dot: options?.dot ?? false }),
        )
        return new Set(files.map(keyFor))
    } catch {
        return new Set()
    }
}
