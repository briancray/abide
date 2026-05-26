/*
Derives the MIME type from a URL pathname using Bun.file().type, which
operates on the file extension synchronously without touching the disk. The
Bun.file ref here is never read from — it exists only to reuse Bun's
extension-to-MIME table. Cache by extension so repeat hits for the same
chunk type (.js / .css / .map / .svg / …) skip the BunFile allocation.
*/
const mimeByExtension = new Map<string, string>()

export function mimeForExtension(pathname: string): string {
    const dot = pathname.lastIndexOf('.')
    const extension = dot === -1 ? '' : pathname.slice(dot)
    const cached = mimeByExtension.get(extension)
    if (cached !== undefined) {
        return cached
    }
    const type = Bun.file(pathname).type
    mimeByExtension.set(extension, type)
    return type
}
