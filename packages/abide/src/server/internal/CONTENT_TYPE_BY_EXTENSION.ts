// Extension → `Content-Type` + compressibility for statically served bytes (`src/ui/public/**` and the
// content-addressed `/__abide/chunk/` assets). Deliberately a fixed table rather than a sniffing library:
// the set of things an app serves statically is small, and a wrong guess on a font or a script is a
// silently broken page (a `.woff2` served as `text/javascript` is rejected by the font loader with no
// console error).
//
// Extensions are stored WITHOUT the leading dot and lowercased; look up through `staticAssetType`, which
// owns the last-dot-of-the-basename rule. An unlisted extension falls back to `application/octet-stream`
// at the call site — never to a text type, since guessing text on unknown bytes invites charset
// corruption.
//
// `compressible` says whether a general-purpose compressor can still win on these bytes, and it lives
// HERE because compressibility is a property of the format, not of the route: a `.woff2` is already
// Brotli-compressed internally and re-compressing it is a measured LOSS (each of the three fonts in
// `packages/docs/src/ui/public/fonts` grows by 10-28 bytes under gzip and is a wash under brotli), while
// a `.wav` is raw PCM and a `.ico` is usually a raw bitmap, so both compress hard despite sitting next to
// their already-compressed cousins. The flag is only ever a permission to TRY — `compressChunk` keeps an
// encoding only when it actually beats the identity bytes, so a marginal `true` here costs nothing.
export const CONTENT_TYPE_BY_EXTENSION: Readonly<
    Record<string, { type: string; compressible: boolean }>
> = {
    // Text/code — these carry an explicit charset; the bytes abide emits are always UTF-8.
    css: { type: 'text/css; charset=utf-8', compressible: true },
    js: { type: 'text/javascript; charset=utf-8', compressible: true },
    mjs: { type: 'text/javascript; charset=utf-8', compressible: true },
    json: { type: 'application/json; charset=utf-8', compressible: true },
    map: { type: 'application/json; charset=utf-8', compressible: true },
    html: { type: 'text/html; charset=utf-8', compressible: true },
    txt: { type: 'text/plain; charset=utf-8', compressible: true },
    xml: { type: 'application/xml; charset=utf-8', compressible: true },
    webmanifest: { type: 'application/manifest+json; charset=utf-8', compressible: true },

    // Fonts. `font/*` is the modern registered tree (RFC 8081) — not the older
    // `application/font-woff`, which some loaders now decline. woff/woff2 carry their own compression
    // (Brotli for woff2, zlib for woff); ttf/otf are uncompressed tables and compress well.
    woff2: { type: 'font/woff2', compressible: false },
    woff: { type: 'font/woff', compressible: false },
    ttf: { type: 'font/ttf', compressible: true },
    otf: { type: 'font/otf', compressible: true },

    // Images. `svg` is text but is served as its registered image type, with charset (it is XML).
    // Every raster format below is already entropy-coded except `ico`, which is classically a raw BMP.
    svg: { type: 'image/svg+xml; charset=utf-8', compressible: true },
    png: { type: 'image/png', compressible: false },
    jpg: { type: 'image/jpeg', compressible: false },
    jpeg: { type: 'image/jpeg', compressible: false },
    gif: { type: 'image/gif', compressible: false },
    webp: { type: 'image/webp', compressible: false },
    avif: { type: 'image/avif', compressible: false },
    ico: { type: 'image/x-icon', compressible: true },

    // Media. `wav` is uncompressed PCM; the rest are codec-compressed containers.
    mp4: { type: 'video/mp4', compressible: false },
    webm: { type: 'video/webm', compressible: false },
    mp3: { type: 'audio/mpeg', compressible: false },
    ogg: { type: 'audio/ogg', compressible: false },
    wav: { type: 'audio/wav', compressible: true },

    // Archives / misc. `wasm` is an uncompressed binary module format and compresses substantially.
    pdf: { type: 'application/pdf', compressible: false },
    wasm: { type: 'application/wasm', compressible: true },
    zip: { type: 'application/zip', compressible: false },
}
