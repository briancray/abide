// Where a handler lives IS what it is, what it is addressed by, and which stub the browser gets.
//
//     server/rpc/users.ts       export const NAME = GET(…)     // …or POST / PUT / PATCH / DELETE
//     server/sockets/feed.ts    export const NAME = socket(…)
//
// The DIRECTORY is the kind, so the lane knows which stub to write before it reads the file. A Bun
// plugin filter is a PATH regex, which is what rules out a `'use server'` directive: a directive
// lives in the file's text, so recognising one means intercepting every `.ts` in the graph and
// taking responsibility for loading all of them.
//
// An endpoint is recognised SYNTACTICALLY, with the same scanner `.abide` uses and for the same
// reason: the emit path must not need a type-checker, because the browser lane produces the stub
// from a file whose body it is about to throw away. Anything else exported is a compile error naming
// the export — the alternative is a stub exporting `undefined` for a helper somebody imported, which
// fails in a browser, at a call site, with no mention of the file that dropped it.
//
// The id is the module's path under its directory plus the export name, and there is no hash: two
// endpoints can only collide if two files collide, and the filesystem already prevents that. An
// address legible in a network panel and a stack trace is worth more than the bytes a hash saved.

import { SyntaxKind } from 'typescript/unstable/ast'
// Type-only, so nothing about the runtime reaches the compiler: the emitted `__register("rpc", …)`
// IS the contract between the two, and a `Kind` declared twice is a rename that compiles on both
// sides and fails on the wire.
import type { Shapes } from '$shared/internal/shapes.ts'
import type { Kind } from '$shared/transport.ts'
import { SyntaxError_, type Token, tokensOf } from './lex.ts'
import { crossing, type Declared, shapesAt, TypeReader, type TypeSource } from './shape.ts'

const RPC_DIRECTORY = '/server/rpc/'
const SOCKET_DIRECTORY = '/server/sockets/'

/**
 * Every `.ts` a transport directory holds. The plugin's filter, and nothing else matches it.
 *
 * Derived like the two globs below, and for a sharper version of the same reason: this one is the
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
 * The same rule ANCHORED at a project root — what a BOOT scans with.
 *
 * The difference is what the scan is FOR. A pass that only reads may match a transport directory
 * anywhere under the tree: a fixture under `types/checker/server/rpc/` is a module whose shapes are
 * worth deriving, and deriving one nobody serves costs nothing. A boot IMPORTS what it finds, and
 * that fixture is not an endpoint of the app — its module body would run, its declarations would
 * register, and its address would collide with the real `server/rpc/` file of the same name, because
 * an id is cut at the LAST transport directory in a path.
 */
export const TRANSPORT_ROOTS: Record<Kind, string> = {
    // The same string with its `**/` prefix cut, rather than the tail written a second time: a
    // scanner whose suffix drifts from the one above finds nothing, and "no endpoints" is what an
    // app made only of pages looks like too.
    rpc: TRANSPORT_GLOBS.rpc.slice(ANYWHERE.length),
    socket: TRANSPORT_GLOBS.socket.slice(ANYWHERE.length),
}

const RPC_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const SOCKET_METHODS = ['socket'] as const

type Method = (typeof RPC_METHODS)[number] | (typeof SOCKET_METHODS)[number]

const LEGAL: Record<Kind, readonly string[]> = { rpc: RPC_METHODS, socket: SOCKET_METHODS }
const DIRECTORIES: Record<Kind, string> = { rpc: RPC_DIRECTORY, socket: SOCKET_DIRECTORY }

/**
 * One endpoint, as its own declaration describes it.
 *
 * `streams`, `input` and `output` all come from `shapesAt`, which reads them off the same tokens in
 * one pass — so they are carried in the type it returns rather than restated here. `input` is the
 * MESSAGE shape on a socket, and `output` is per CHUNK on a handler that yields.
 */
export interface Endpoint extends Declared {
    name: string
    method: Method
}

/** A positioned compile failure, like every other one — so `describe` places it with no new branch. */
export class ElisionError extends SyntaxError_ {
    constructor(message: string, position: number) {
        super(message, position)
        this.name = 'AbideElisionError'
    }
}

/** Which transport a module declares, or `null` if it declares none. */
export function kindOf(modulePath: string): Kind | null {
    if (modulePath.includes(RPC_DIRECTORY)) return 'rpc'
    if (modulePath.includes(SOCKET_DIRECTORY)) return 'socket'
    return null
}

/** The module's own path under its transport directory — every id in the file shares it. */
function moduleAddress(modulePath: string, kind: Kind): string {
    const directory = DIRECTORIES[kind]
    const rest = modulePath.slice(modulePath.lastIndexOf(directory) + directory.length)
    return rest.endsWith('.ts') ? rest.slice(0, -3) : rest
}

/**
 * The id scheme itself, in one place.
 *
 * `stub` and `registration` join through this rather than spelling the separator themselves, so the
 * addresses they emit and the one `endpointId` answers with cannot drift apart.
 */
function joinId(address: string, exportName: string): string {
    return `${address}/${exportName}`
}

/** `users/getUser` — the module under its transport directory, then the export. */
export function endpointId(modulePath: string, exportName: string): string {
    const kind = kindOf(modulePath)
    if (kind === null) {
        throw new ElisionError(`abide: ${modulePath} is not under ${RPC_DIRECTORY} or ${SOCKET_DIRECTORY}`, 0)
    }
    return joinId(moduleAddress(modulePath, kind), exportName)
}

/**
 * Every endpoint a transport module declares, in source order.
 *
 * `resolve` is what lets a type declared in ANOTHER file still be published. Optional, and absent in
 * the browser lane by construction: the stub carries no shapes, so the lane that throws the module
 * away also does none of the reads.
 */
export function endpointsOf(source: string, filename: string, kind: Kind, resolve?: TypeSource): Endpoint[] {
    const legal = LEGAL[kind]
    const tokens = tokensOf(source)
    // Built once per module and reused by every declaration in it, because a local `type`/`interface`
    // two handlers both name is one type and should be read once — and because a module it imports
    // from is opened once for the whole file rather than once per declaration.
    const types = new TypeReader(tokens, filename, resolve === undefined ? null : crossing(resolve))
    const endpoints: Endpoint[] = []

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        // Only a TOP-LEVEL export is an export. `depth` is the count after the token, so an `export`
        // inside a block — which is not legal anyway — is simply not seen here.
        if (token.depth !== 0 || token.kind !== SyntaxKind.ExportKeyword) continue

        const what = tokens[i + 1]
        if (what === undefined) break
        // Erased before anything runs, so neither lane has to account for it.
        if (what.text === 'type' || what.text === 'interface') continue

        if (what.kind !== SyntaxKind.ConstKeyword) {
            throw new ElisionError(
                `abide: ${filename} exports \`${what.text}\`, which is not an endpoint — a module under a transport directory may export only \`export const NAME = ${legal.join(' / ')}(…)\`, because everything else has no client form`,
                what.start,
            )
        }

        const name = tokens[i + 2]
        if (name === undefined) break
        let equals = i + 3
        // A type annotation is SKIPPED rather than read: an endpoint naming its own —
        // `export const rooms: KeyedChannel<…> = socket(…)` — is ordinary authoring, and the DECLARATION
        // is what says the shape. The type arguments on `socket<…>` below are the same fact where it
        // can be read.
        if ((tokens[equals] as Token | undefined)?.kind === SyntaxKind.ColonToken) {
            // Through the type reader rather than by scanning for the first `=`: a generic default
            // in the annotation — `KeyedChannel<Args, T = Tick>` — puts an `=` inside the type, and a
            // scan that stopped there would read the method off a type token.
            equals = types.extent(equals + 1)
        }
        const method = tokens[equals + 1]
        // `method === undefined` alone: past the end, the read above is already undefined.
        if (method === undefined) break
        if (
            name.kind !== SyntaxKind.Identifier ||
            (tokens[equals] as Token).kind !== SyntaxKind.EqualsToken
        ) {
            throw new ElisionError(
                `abide: ${filename} exports \`${name.text}\`, which is not an endpoint — expected \`export const ${name.text} = ${legal[0]}(…)\``,
                name.start,
            )
        }
        if (!legal.includes(method.text)) {
            throw new ElisionError(
                `abide: ${filename} declares \`${name.text}\` with \`${method.text}\`, but a ${kind} module may only declare ${legal.join(' / ')} — move it, or change it`,
                method.start,
            )
        }
        const at = equals + 1
        endpoints.push({
            name: name.text,
            method: method.text as Method,
            ...shapesAt(types, at, kind === 'rpc'),
        })
        i = at
    }
    return endpoints
}

/** What the browser gets: the same export names, none of the module they came from. */
export function stub(modulePath: string, kind: Kind, endpoints: Endpoint[]): string {
    const socket = kind === 'socket'
    const build = socket ? '__socket' : '__remote'
    const address = moduleAddress(modulePath, kind)
    // `abide/runtime/transport` and NOT `abide/runtime`, and the reason is the chunk this lands in
    // rather than the name. The generated client entry imports `abide/runtime` for `routes` /
    // `outlet` / `ready`, so that module is in the entry's own chunk — and a re-export from it is in
    // there too, however few pages reach it. One lazy route with one rpc therefore put the whole
    // call-and-decode path into the bundle EVERY page loads: 4,066 bytes of the perf app's shared
    // entry, on `/simple`, which calls nothing. Imported by its own specifier it lands in the chunk
    // of whatever page imports it, which is the page that has the rpc.
    let out = socket
        ? `import { remoteSocket as __socket } from "abide/runtime/transport"\n`
        : `import { remote as __remote } from "abide/runtime/transport"\n`
    for (const endpoint of endpoints) {
        const id = JSON.stringify(joinId(address, endpoint.name))
        // A socket stub takes no options at all: the method is the directory, and a socket never
        // streams-or-not — it always does.
        let options = ''
        if (!socket) {
            const stream = endpoint.streams ? ', stream: true' : ''
            options = `, { method: ${JSON.stringify(endpoint.method)}${stream} }`
        }
        out += `export const ${endpoint.name} = ${build}(${id}${options})\n`
    }
    return out
}

/**
 * What the server gets: the module unchanged, plus its own address. APPENDED, so every line the
 * author wrote keeps its number and a stack trace still points at the handler.
 */
export function registration(modulePath: string, kind: Kind, endpoints: Endpoint[]): string {
    if (endpoints.length === 0) return ''
    const address = moduleAddress(modulePath, kind)
    const pairs: [string, string][] = []
    const shapes: Record<string, Shapes> = {}
    let names = ''
    let derived = false
    for (const endpoint of endpoints) {
        pairs.push([joinId(address, endpoint.name), endpoint.name])
        names += names === '' ? endpoint.name : `, ${endpoint.name}`
        if (endpoint.input === undefined && endpoint.output === undefined) continue
        derived = true
        // Both fields, whatever they hold: `shapesAt` writes them on every endpoint it builds, so
        // there is nothing left for a conditional spread to decide — and `JSON.stringify` below
        // drops an undefined value, so the emitted registration is byte-identical.
        shapes[endpoint.name] = { input: endpoint.input, output: endpoint.output }
    }
    // Omitted entirely when nothing was derivable, so a module whose types this cannot read emits
    // exactly the text it emitted before there was a derivation at all.
    const carried = derived ? `, ${JSON.stringify(shapes)}` : ''
    return (
        `\nimport { register as __register } from "abide/server"\n` +
        `__register(${JSON.stringify(kind)}, ${JSON.stringify(pairs)}, { ${names} }${carried})\n`
    )
}
