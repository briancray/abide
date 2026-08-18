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
import type { Shapes } from '#shared/internal/shapes.ts'
import type { Kind } from '#shared/transport.ts'
// The directory rule, from the leaf that owns it: the cli and the boot scan with these too, and an
// edge onto THIS module would hand them TypeScript's scanner for two glob strings.
import { TRANSPORT_DIRECTORIES } from '../TRANSPORT.ts'
import { SyntaxError_, type Token, tokensOf } from './lex.ts'
import { crossing, type Declared, shapesAt, TypeReader, type TypeSource } from './shape.ts'

const RPC_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const SOCKET_METHODS = ['socket'] as const

type Method = (typeof RPC_METHODS)[number] | (typeof SOCKET_METHODS)[number]

const LEGAL: Record<Kind, readonly string[]> = { rpc: RPC_METHODS, socket: SOCKET_METHODS }

/**
 * One endpoint, as its own declaration describes it.
 *
 * `streams`, `input` and `output` all come from `shapesAt`, which reads them off the same tokens in
 * one pass — so they are carried in the type it returns rather than restated here. `input` is the
 * MESSAGE shape on a socket, and `output` is per CHUNK on a handler that yields.
 */
export interface Endpoint extends Declared {
    /** The LOCAL binding, which is what the appended registration names. */
    name: string
    method: Method
    /** `export default NAME`, which is addressed by the module path with no export on the end. */
    asDefault: boolean
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
    if (modulePath.includes(TRANSPORT_DIRECTORIES.rpc)) return 'rpc'
    if (modulePath.includes(TRANSPORT_DIRECTORIES.socket)) return 'socket'
    return null
}

/**
 * The same question asked of an IMPORT SPECIFIER rather than of a path on a disk.
 *
 * Two spellings reach the same module and neither is a path: `../../server/rpc/x.ts` from inside the
 * server seam, and `#server/rpc/x.ts` from anywhere else — which is what an app writes now that its
 * seams are subpath imports. The leading `/` makes a bare `server/rpc/x.ts` match on the same test a
 * relative one does, and the `#` comes off first because a seam alias is the DIRECTORY under a
 * different name. Both land on `kindOf`, so there is still one answer to what a transport module is.
 *
 * Getting this wrong is silent and expensive: an rpc the emitter does not recognise is not registered
 * as a keyed source, so the cell sugar stops inserting the read and `bodyOf(args).source` compiles to
 * a property access on a handle.
 */
export function kindOfImport(specifier: string): Kind | null {
    return kindOf(`/${specifier.startsWith('#') ? specifier.slice(1) : specifier}`)
}

/** The module's own path under its transport directory — every id in the file shares it. */
function moduleAddress(modulePath: string, kind: Kind): string {
    const directory = TRANSPORT_DIRECTORIES[kind]
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

/**
 * Where one endpoint answers: `users/getUser`, or `users` when it is the module's default.
 *
 * The default drops the segment rather than spelling `users/default`, because the module IS the
 * endpoint then and a path segment naming a keyword reads as one an author chose.
 */
function addressOf(address: string, endpoint: Endpoint): string {
    return endpoint.asDefault ? address : joinId(address, endpoint.name)
}

/** `users/getUser` — the module under its transport directory, then the export. */
export function endpointId(modulePath: string, exportName: string): string {
    const kind = kindOf(modulePath)
    if (kind === null) {
        throw new ElisionError(
            `abide: ${modulePath} is not under ${TRANSPORT_DIRECTORIES.rpc} or ${TRANSPORT_DIRECTORIES.socket}`,
            0,
        )
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
    let defaultBinding: Token | null = null

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        // Only a TOP-LEVEL export is an export. `depth` is the count after the token, so an `export`
        // inside a block — which is not legal anyway — is simply not seen here.
        if (token.depth !== 0 || token.kind !== SyntaxKind.ExportKeyword) continue

        const what = tokens[i + 1]
        if (what === undefined) break
        // Erased before anything runs, so neither lane has to account for it.
        if (what.text === 'type' || what.text === 'interface') continue

        // `export default handler` — the module's endpoint, addressed by the module path alone.
        //
        // A BINDING and never `export default POST(…)` directly, which reads better and cannot be
        // made to work: the server lane is the module UNCHANGED plus an appended registration, and
        // that registration maps an address to a local name. A bare default declares no name for it
        // to reference, and a module cannot reach its own default export.
        if (what.kind === SyntaxKind.DefaultKeyword) {
            const target = tokens[i + 2]
            if (target === undefined) break
            if (target.kind !== SyntaxKind.Identifier || (tokens[i + 3] as Token | undefined)?.kind === SyntaxKind.OpenParenToken) {
                throw new ElisionError(
                    `abide: ${filename} exports \`${target.text}(…)\` as its default directly — bind it first, \`const NAME = ${legal[0]}(…)\` and then \`export default NAME\`, because the registration this module gets appended has to name something`,
                    target.start,
                )
            }
            if (defaultBinding !== null) {
                throw new ElisionError(`abide: ${filename} has two default exports`, target.start)
            }
            defaultBinding = target
            i += 2
            continue
        }

        if (what.kind !== SyntaxKind.ConstKeyword) {
            throw new ElisionError(
                `abide: ${filename} exports \`${what.text}\`, which is not an endpoint — a module under a transport directory may export only \`export const NAME = ${legal.join(' / ')}(…)\`, because everything else has no client form`,
                what.start,
            )
        }

        const found = declarationAt(tokens, types, i + 1, filename, kind, legal, true)
        if (found === null) break
        endpoints.push(found.endpoint)
        i = found.at
    }

    if (defaultBinding === null) return endpoints

    // The binding is looked up AFTER the walk, because `export default handler` may sit above the
    // `const` it names — hoisting is the reader's expectation and a one-pass rule would forbid it.
    const name = defaultBinding.text
    if (endpoints.some((endpoint) => endpoint.name === name)) {
        throw new ElisionError(
            `abide: ${filename} exports \`${name}\` and also defaults to it, which would address one endpoint twice — as \`…/${name}\` and as the module. Drop the \`export\` on the const, or drop the default`,
            defaultBinding.start,
        )
    }
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (token.depth !== 0 || token.kind !== SyntaxKind.ConstKeyword) continue
        if ((tokens[i + 1] as Token | undefined)?.text !== name) continue
        const found = declarationAt(tokens, types, i, filename, kind, legal, false)
        if (found === null) break
        endpoints.push({ ...found.endpoint, asDefault: true })
        return endpoints
    }
    throw new ElisionError(
        `abide: ${filename} defaults to \`${name}\`, which is not declared here — a default export must name a \`const ${name} = ${legal[0]}(…)\` in this module`,
        defaultBinding.start,
    )
}

/**
 * One `const NAME = METHOD(…)`, read from the index of its `const`.
 *
 * Shared by the two callers so an exported declaration and a defaulted one cannot disagree about what
 * an endpoint IS — the only difference between them is the address, which is `registration`'s and
 * `stub`'s to decide. `null` means the token stream ended mid-declaration.
 */
function declarationAt(
    tokens: Token[],
    types: TypeReader,
    constIndex: number,
    filename: string,
    kind: Kind,
    legal: readonly string[],
    exported: boolean,
): { endpoint: Endpoint; at: number } | null {
    const name = tokens[constIndex + 1]
    if (name === undefined) return null
    let equals = constIndex + 2
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
    if (method === undefined) return null
    if (name.kind !== SyntaxKind.Identifier || (tokens[equals] as Token).kind !== SyntaxKind.EqualsToken) {
        const how = exported ? `export const ${name.text}` : `const ${name.text}`
        throw new ElisionError(
            `abide: ${filename} exports \`${name.text}\`, which is not an endpoint — expected \`${how} = ${legal[0]}(…)\``,
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
    return {
        endpoint: {
            name: name.text,
            method: method.text as Method,
            asDefault: false,
            ...shapesAt(types, at, kind === 'rpc'),
        },
        at,
    }
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
        const id = JSON.stringify(addressOf(address, endpoint))
        // A socket stub takes no options at all: the method is the directory, and a socket never
        // streams-or-not — it always does.
        let options = ''
        if (!socket) {
            const stream = endpoint.streams ? ', stream: true' : ''
            options = `, { method: ${JSON.stringify(endpoint.method)}${stream} }`
        }
        out += endpoint.asDefault
            ? `export default ${build}(${id}${options})\n`
            : `export const ${endpoint.name} = ${build}(${id}${options})\n`
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
        pairs.push([addressOf(address, endpoint), endpoint.name])
        names += names === '' ? endpoint.name : `, ${endpoint.name}`
        if (endpoint.input === undefined && endpoint.output === undefined && endpoint.room === undefined) {
            continue
        }
        derived = true
        // Every field, whatever it holds: `shapesAt` writes them all on every endpoint it builds, so
        // there is nothing left for a conditional spread to decide — and `JSON.stringify` below
        // drops an undefined value, so the emitted registration is byte-identical.
        shapes[endpoint.name] = { input: endpoint.input, output: endpoint.output, room: endpoint.room }
    }
    // Omitted entirely when nothing was derivable, so a module whose types this cannot read emits
    // exactly the text it emitted before there was a derivation at all.
    const carried = derived ? `, ${JSON.stringify(shapes)}` : ''
    return (
        // `abide/server/internal`, not `abide/server`: registering is the SERVING half, which
        // `abide start` does and an app never types. What an app writes is the `GET(…)` above.
        `\nimport { register as __register } from "abide/server/internal"\n` +
        `__register(${JSON.stringify(kind)}, ${JSON.stringify(pairs)}, { ${names} }${carried})\n`
    )
}
