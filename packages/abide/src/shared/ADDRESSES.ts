// EVERY ADDRESS THE FRAMEWORK ANSWERS AT, named once for the sides that have to agree about them:
// the build writes them into the browser's bundle, the server answers them, the compiler files
// handlers under them, and a browser dials them. A leaf, with no imports of its own, for the
// reason every constant crossing a seam is one — a string spelled out on two sides is a request
// that silently reaches nothing.

/**
 * The namespace every framework address lives under.
 *
 * UNDER `/__abide`, which is the namespace the framework's own addresses live in (19.1, 20.5,
 * 25.1). That is what makes a route table and an asset table incapable of colliding: a page is a
 * directory under `pages/` and no directory there can be named `__abide` without an author
 * writing it, so nothing has to be checked at build time and nothing can be shadowed at run time.
 * 38.21 is the clause.
 */
export const ABIDE_ADDRESS = '/__abide'

/**
 * Where the browser bundle is served.
 *
 * The bundle's own address below `ABIDE_ADDRESS` (38.17, 38.21). One request path answers
 * everything under `ABIDE_ADDRESS` and the command supplying the app decides what is there, so a
 * command with a second address of its own — the reload client `abide dev` serves (38.18) — adds
 * one rather than a lane.
 */
export const CLIENT_ADDRESS = `${ABIDE_ADDRESS}/client`

// 20.5, 20.9, 36.7 — the generated surfaces, which the CLI reaches as well as the server answers.

/** The generated OpenAPI document. */
export const OPENAPI_ADDRESS = `${ABIDE_ADDRESS}/openapi.json`
/** The MCP endpoint. */
export const MCP_ADDRESS = `${ABIDE_ADDRESS}/mcp`
/** The stream of log records. */
export const LOGS_ADDRESS = `${ABIDE_ADDRESS}/logs`
/** The health check. */
export const HEALTH_ADDRESS = `${ABIDE_ADDRESS}/health`
/** Where a visitor's Claude Code bridge pairs, and is relayed turns (45.13). */
export const BRIDGE_ADDRESS = `${ABIDE_ADDRESS}/bridge`

/**
 * The socket the dev reload client holds open.
 *
 * 38.18 — the LISTENER upgrades it on the main thread and the dev WORKER serves the script that
 * opens it.
 */
export const DEV_ADDRESS = `${ABIDE_ADDRESS}/dev`

/**
 * Where a `server/rpc` handler is answered over http.
 *
 * 16.2 — its path below that directory, then its export name (19.1). The build writes the address
 * into the browser's wrapper and the server answers at it.
 */
export const RPC_ADDRESS = `${ABIDE_ADDRESS}/rpc`

/**
 * Where the one web socket every `socket` is carried over is served, below the app's root.
 *
 * 18.2 — the server answers the upgrade there, the compiler files each socket under it, and a
 * browser's `socketWire` dials it.
 */
export const SOCKET_ADDRESS = `${ABIDE_ADDRESS}/socket`

/**
 * Where a browser loads the principal document the server resolved from the sealed cookie.
 *
 * 26.2.
 */
export const PRINCIPAL_ADDRESS = `${ABIDE_ADDRESS}/principal`
