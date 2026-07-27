import { CONTENT_TYPE_BY_EXTENSION } from './CONTENT_TYPE_BY_EXTENSION.ts'

// The single owner of the extension rule for statically served bytes: the last dot of the last path
// segment. Both static routes look up through here so `/__abide/chunk/` and `src/ui/public/**` can never
// disagree about what a `.svg` is — they previously hand-rolled the same scan with different separators.
//
// The two failure modes are distinct and the callers act on them differently, so they are reported
// differently rather than collapsed into one `undefined`:
//   - NO extension (`/memo`, `/users/7`, `/.well-known/x`, a trailing dot) → undefined. This is a page
//     route, and `servePublicFile` uses it to bail before touching the filesystem.
//   - An extension that is not in the table → an entry with `type: undefined`. The bytes exist and can
//     be served; only the media type is unknown, and the right fallback differs by route (a public file
//     is `application/octet-stream`, a chunk asset is JavaScript), so choosing one is the caller's job.
// An unlisted extension is never `compressible` — that flag is a claim about the format, and an unknown
// format supports no claim.
export function staticAssetType(
    name: string,
): { extension: string; type: string | undefined; compressible: boolean } | undefined {
    let start = 0
    for (let i = name.length - 1; i >= 0; i--) {
        const code = name.charCodeAt(i)
        if (code === 47 || code === 92) {
            start = i + 1
            break
        }
    }
    const dot = name.lastIndexOf('.')
    if (dot <= start || dot === name.length - 1) return undefined
    const extension = name.slice(dot + 1).toLowerCase()
    const known = CONTENT_TYPE_BY_EXTENSION[extension]
    if (known === undefined) return { extension, type: undefined, compressible: false }
    return { extension, type: known.type, compressible: known.compressible }
}
