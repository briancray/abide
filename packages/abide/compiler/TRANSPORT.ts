// Where a transport module lives, as the four spellings of one directory rule.
//
// Its own module because these cross a seam and the machinery that reads them does not: `elide.ts`
// pulls TypeScript's scanner, `./lex.ts` and `./shape.ts`, so the cli asking it for two glob strings
// paid that whole graph — an edge is priced by the module it lands on, never by the name it asks
// for. A leaf cannot do that to anybody, which is the shape `PRELOAD_FILE.ts` beside it already has.
//
// Everything here is DERIVED from the two directories rather than written out a second time. A
// spelling that drifts finds nothing and reports nothing, and "no endpoints" is indistinguishable
// from an app that has none.

// Type-only, so this stays a leaf: `Kind` is the runtime's own name for what an endpoint is, and the
// import is erased before anything imports the file.
import type { Kind } from '#shared/transport.ts'
// The other half of the same rule, and the only value imported here — a leaf of strings, so this one
// stays as cheap as it was. `SOURCE_DIR` is what the ANCHORED spelling below gains over the loose one.
import { SOURCE_DIR } from './LAYOUT.ts'

const RPC_DIRECTORY = '/server/rpc/'
const SOCKET_DIRECTORY = '/server/sockets/'

/**
 * Every `.ts` a transport directory holds. The plugin's filter, and nothing else matches it.
 *
 * Derived like the globs below, and for a sharper version of the same reason: this one is the
 * `onLoad` filter, so a spelling that drifted from the directories above would silently stop
 * matching — no elision, and the server module goes into the browser bundle verbatim.
 */
export const TRANSPORT_MODULE = new RegExp(`(${RPC_DIRECTORY}|${SOCKET_DIRECTORY})[^?]+\\.ts$`)

/** The leading wildcard that makes a glob match at any depth — what an ANCHORED spelling drops. */
const ANYWHERE = '**/'

/**
 * The same rule as a glob, per kind — what a build SCANS with.
 *
 * Derived from the directories above rather than written out again, because a scanner that misses a
 * renamed directory finds nothing and reports nothing: the checker pass would simply publish no
 * upgrades, which is indistinguishable from having none to publish.
 *
 * Strings rather than `Bun.Glob`, because this module loads in the browser lane too.
 */
export const TRANSPORT_GLOBS: Record<Kind, string> = {
    // `RPC_DIRECTORY` opens with the same slash `ANYWHERE` closes on, so it is sliced off here.
    rpc: `${ANYWHERE}${RPC_DIRECTORY.slice(1)}**/*.ts`,
    socket: `${ANYWHERE}${SOCKET_DIRECTORY.slice(1)}**/*.ts`,
}

/**
 * The same rule ANCHORED under an app's source directory — what a BOOT scans with.
 *
 * The difference is what the scan is FOR. A pass that only reads may match a transport directory
 * anywhere under the tree: a fixture under `tests/types/checker/server/rpc/` is a module whose shapes
 * are worth deriving, and deriving one nobody serves costs nothing. A boot IMPORTS what it finds, and
 * that fixture is not an endpoint of the app — its module body would run, its declarations would
 * register, and its address would collide with the real `src/server/rpc/` file of the same name,
 * because an id is cut at the LAST transport directory in a path.
 *
 * Anchoring it at `src/` is what keeps those two apart now that a fixture tree is inside the app:
 * only the endpoints an app SERVES are under its server seam, and a fixture is an argument to a case.
 */
export const TRANSPORT_ROOTS: Record<Kind, string> = {
    // The same string with its `**/` prefix cut and the source directory in front, rather than the
    // tail written a second time: a scanner whose suffix drifts from the one above finds nothing, and
    // "no endpoints" is what an app made only of pages looks like too.
    rpc: `${SOURCE_DIR}/${TRANSPORT_GLOBS.rpc.slice(ANYWHERE.length)}`,
    socket: `${SOURCE_DIR}/${TRANSPORT_GLOBS.socket.slice(ANYWHERE.length)}`,
}

/** Which kind a transport directory in a path names — the DIRECTORY is the kind, read back off it. */
export const TRANSPORT_DIRECTORIES: Record<Kind, string> = { rpc: RPC_DIRECTORY, socket: SOCKET_DIRECTORY }
