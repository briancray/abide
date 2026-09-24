// WHERE THE BROWSER BUNDLE IS, named once for the commands that have to agree about it:
// `abide build` writes it, `abide start` answers it, and `abide dev` builds it into memory and
// answers it at the same address (38.17, 38.21). A leaf, with no imports of its own, for
// the reason every constant crossing a seam is one — the build is in `bin/` and the server is in
// `src/server/`, and a string spelled out in both is a build that silently serves nothing.
//
// UNDER `/__abide`, which is the namespace the framework's own addresses already live in (19.1,
// 20.5, 25.1). That is what makes a route table and an asset table incapable of colliding: a page
// is a directory under `pages/` and no directory there can be named `__abide` without an author
// writing it, so nothing has to be checked at build time and nothing can be shadowed at run time.
// 38.21 is the clause.
export const ABIDE_ADDRESS = '/__abide'

// The bundle's own address below it. One request path answers everything under `ABIDE_ADDRESS`
// and the command supplying the app decides what is there, so a command with a second address of
// its own — the reload client `abide dev` serves (38.18) — adds one rather than a lane.
export const CLIENT_ADDRESS = `${ABIDE_ADDRESS}/client`

// 20.5, 20.9, 36.7 — the generated surfaces, which the CLI reaches as well as the server answers.
export const OPENAPI_ADDRESS = `${ABIDE_ADDRESS}/openapi.json`
export const MCP_ADDRESS = `${ABIDE_ADDRESS}/mcp`
export const LOGS_ADDRESS = `${ABIDE_ADDRESS}/logs`
export const HEALTH_ADDRESS = `${ABIDE_ADDRESS}/health`

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

// 38.18 — the socket the reload client holds open. Here rather than in the dev server's own file
// for the same reason as the address above: the LISTENER upgrades it on the main thread and the
// dev WORKER serves the script that opens it, and a string spelled out in both is a reload that
// silently never happens.
export const DEV_ADDRESS = `${ABIDE_ADDRESS}/dev`

// 16.2 — where a handler under `server/rpc` is answered over http: its path below that directory,
// then its export name (19.1). Here for `CLIENT_ADDRESS`'s reason: the build writes the address
// into the browser's wrapper and the server answers at it.
export const RPC_ADDRESS = `${ABIDE_ADDRESS}/rpc`

// 16.29 — where the build puts the module a browser gets in place of each handler module, below the
// build's own output: the source's path, with this in front. One lookup for the client bundle to make
// (`fenceServer`), and a place a reader can open to see exactly what the browser was handed.
export const WIRE_DIRECTORY = 'wire'
