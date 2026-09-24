// WHERE THE BROWSER BUNDLE LANDS, named once for the commands that have to agree about it:
// `abide build` writes it, `abide start` answers it, and `abide dev` builds it into memory
// (38.17, 38.21). A leaf, with no imports of its own, for the reason every constant crossing a
// seam is one — the build is in `bin/` and the server is in `src/server/`, and a string spelled out
// in both is a build that silently serves nothing. The addresses it is answered at are
// `#shared/ADDRESSES.ts`.

// The directory the bundle lands in, below the build's own output directory.
export const CLIENT_DIRECTORY = 'client'

// The module that mounts the app, and so the one file in the bundle whose name the shell writes
// out. Everything else a page needs is reached from here and named by the bundler.
//
// THE STYLESHEET IS THE SAME NAME. A `.abide` that imports a stylesheet (34.6) makes it a
// dependency of the client module, and the bundler collects every one it reaches under an entry
// into `<entry>.css` — so the extension is the whole difference and there is no second constant.
export const CLIENT_ENTRY = 'entry'

// 38.5 — where `abide build` writes the manifest `chunksByModule` reads off the bundle, below its
// own output directory and BESIDE the client directory rather than in it: everything in there is
// answered under `CLIENT_ADDRESS` (38.21), and the manifest is the server's, not the browser's.
export const MANIFEST = 'manifest.json'

// 38.5 — THE ENCODINGS A RESPONSE CAN BE COMPRESSED IN, in the order a tie is broken, and the suffix
// `abide build` writes each precompressed file under. Brotli first: it is the smaller of the two
// on the bundle, and every browser that sends it over https decodes it. Gzip is the one a browser
// asks for over plain http. The build writes these and `abide start` reads them, so the suffix
// spelled twice is a build that precompresses into files nothing ever serves.
export const ENCODING_SUFFIX = { br: '.br', gzip: '.gz' } as const

// 38.19 — where `abide build` copies `src/ui/public`, below its own output directory. A directory
// rather than the source tree: `abide start` boots what the build produced and reaches for nothing
// an app might have moved since.
export const PUBLIC_DIRECTORY = 'public'

// 16.29 — where the build puts the module a browser gets in place of each handler module, below the
// build's own output: the source's path, with this in front. One lookup for the client bundle to make
// (`fenceServer`), and a place a reader can open to see exactly what the browser was handed.
export const WIRE_DIRECTORY = 'wire'
