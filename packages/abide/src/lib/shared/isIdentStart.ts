/* True when `c` can begin a JavaScript identifier (ASCII letters, `_`, `$`). Shared by the
   source scanners (findExportCallSite, skipNonCode) to find identifiers and regex flags. */
export function isIdentStart(c: string | undefined): boolean {
    if (c === undefined) {
        return false
    }
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '$'
}
