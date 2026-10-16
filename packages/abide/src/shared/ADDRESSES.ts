// EVERY ADDRESS THE FRAMEWORK ANSWERS AT, named once for the sides that have to agree about them:
// the build writes them into the browser's bundle, the server answers them, the compiler files
// handlers under them, and a browser dials them. A leaf, with no imports of its own, for the
// reason every constant crossing a seam is one — a string spelled out on two sides is a request
// that silently reaches nothing.

/**
 * The namespace every framework address lives under.
 *
 * UNDER `/__abide`, which is the namespace the framework's own addresses live in (20.5, 25.1).
 * That is what keeps the app's routes and abide's own addresses from colliding: a route whose first
 * segment is `__abide` is refused at build (23.17), so nothing can be shadowed at run time. 38.20
 * is the clause.
 */
export const ABIDE_ADDRESS = '/__abide'

/**
 * Where the browser bundle is served.
 *
 * The bundle's own address below `ABIDE_ADDRESS` (38.16, 38.20). One request path answers
 * everything under `ABIDE_ADDRESS` and the command supplying the app decides what is there, so a
 * command with a second address of its own — the reload client `abide dev` serves (38.17) — adds
 * one rather than a lane.
 */
export const CLIENT_ADDRESS = `${ABIDE_ADDRESS}/client`

/** Where a private handler is answered, below its file's path and then its name (16.70). */
export const PRIVATE_HANDLERS_ADDRESS = `${ABIDE_ADDRESS}/handlers`

// 20.5, 20.9, 36.7 — the generated surfaces, which the CLI reaches as well as the server answers.

/** The generated OpenAPI document. */
export const OPENAPI_ADDRESS = `${ABIDE_ADDRESS}/openapi.json`
/** The MCP endpoint. */
export const MCP_ADDRESS = `${ABIDE_ADDRESS}/mcp`
/** The health check. */
export const HEALTH_ADDRESS = `${ABIDE_ADDRESS}/health`
/** Where a visitor's Claude Code bridge pairs, and is relayed turns (44.13). */
export const BRIDGE_ADDRESS = `${ABIDE_ADDRESS}/bridge`

/**
 * The socket the dev reload client holds open.
 *
 * 38.17 — the LISTENER upgrades it on the main thread and the dev WORKER serves the script that
 * opens it.
 */
export const DEV_ADDRESS = `${ABIDE_ADDRESS}/dev`

/**
 * Where the one web socket a page follows its `GET`s over is served, below the app's root.
 *
 * 18.1 — the server answers the upgrade there, and a browser's mux dials it.
 */
export const SOCKET_ADDRESS = `${ABIDE_ADDRESS}/socket`

/**
 * Where a browser loads the principal document the server resolved from the sealed cookie.
 *
 * 26.2.
 */
export const PRINCIPAL_ADDRESS = `${ABIDE_ADDRESS}/principal`
