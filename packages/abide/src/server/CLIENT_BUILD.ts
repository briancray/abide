// WHAT THE BROWSER BUNDLE IS NAMED, once for the seams that have to agree about it: the compiler
// writes the entry, `abide build` precompresses every file, and the server answers both (38.5,
// 38.20). A leaf, with no imports of its own, for the reason every constant crossing a seam is one.
// Where the bundle lands in a build is `appBuild.ts`'s; the addresses it is answered at are
// `#shared/ADDRESSES.ts`.

/**
 * The module that mounts the app — the one bundle file whose name the shell writes out.
 *
 * Everything else a page needs is reached from here and named by the bundler.
 *
 * THE STYLESHEET IS THE SAME NAME. A `.abide` that imports a stylesheet (34.6) makes it a
 * dependency of the client module, and the bundler collects every one it reaches under an entry
 * into `<entry>.css` — so the extension is the whole difference and there is no second constant.
 */
export const CLIENT_ENTRY = 'entry'

/**
 * The encodings a response can be compressed in, each with its precompressed file's suffix.
 *
 * 38.5 — in the order a tie is broken. Brotli first: it is the smaller of the two on the bundle,
 * and every browser that sends it over https decodes it. Gzip is the one a browser asks for over
 * plain http. The build writes these and `abide start` reads them, so the suffix spelled twice is
 * a build that precompresses into files nothing ever serves.
 */
export const ENCODING_SUFFIX = { br: '.br', gzip: '.gz' } as const
