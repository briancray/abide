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
import type { Kind } from '$shared/transport.ts'
import { Lexer, SyntaxError_ } from './lex.ts'

export const RPC_DIRECTORY = '/server/rpc/'
export const SOCKET_DIRECTORY = '/server/sockets/'

/** Every `.ts` a transport directory holds. The plugin's filter, and nothing else matches it. */
export const TRANSPORT_MODULE = /\/server\/(rpc|sockets)\/[^?]+\.ts$/

export const RPC_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const SOCKET_METHODS = ['socket'] as const

export type Method = (typeof RPC_METHODS)[number] | (typeof SOCKET_METHODS)[number]
export type { Kind }

const LEGAL: Record<Kind, readonly string[]> = { rpc: RPC_METHODS, socket: SOCKET_METHODS }
const DIRECTORIES: Record<Kind, string> = { rpc: RPC_DIRECTORY, socket: SOCKET_DIRECTORY }

export interface Endpoint {
    name: string
    method: Method
    /**
     * The handler YIELDS, so the value arrives as chunks rather than at once.
     *
     * Read off the tokens — `function*` — for the same reason the export itself is: the browser lane
     * has to build a stub that streams from a file it never loads, and an arrow function cannot be a
     * generator, so the syntax is the whole answer. A handler assembled somewhere else and passed in
     * is not seen as one, which is the documented cost of not running a type-checker here.
     */
    streams: boolean
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
 * Does the declaration's first argument yield?
 *
 * Called with the lexer sitting on the method name. Everything up to the opening parenthesis is
 * skipped, which is how an explicit type argument list — `GET<Args, User>(…)` — passes through.
 */
function yields(lexer: Lexer): boolean {
    let token = lexer.next()
    while (token !== null && token.kind !== SyntaxKind.OpenParenToken) token = lexer.next()
    if (token === null) return false
    let at = lexer.next()
    if (at !== null && at.text === 'async') at = lexer.next()
    if (at === null || at.kind !== SyntaxKind.FunctionKeyword) return false
    return lexer.next()?.kind === SyntaxKind.AsteriskToken
}

/** Every endpoint a transport module declares, in source order. */
export function endpointsOf(source: string, filename: string, kind: Kind): Endpoint[] {
    const legal = LEGAL[kind]
    const lexer = new Lexer(source, 0)
    const endpoints: Endpoint[] = []

    for (;;) {
        const token = lexer.next()
        if (token === null) break
        // Only a TOP-LEVEL export is an export. `depth` is the count after the token, so an `export`
        // inside a block — which is not legal anyway — is simply not seen here.
        if (token.depth !== 0 || token.kind !== SyntaxKind.ExportKeyword) continue

        const what = lexer.next()
        if (what === null) break
        // Erased before anything runs, so neither lane has to account for it.
        if (what.text === 'type' || what.text === 'interface') continue

        if (what.kind !== SyntaxKind.ConstKeyword) {
            throw new ElisionError(
                `abide: ${filename} exports \`${what.text}\`, which is not an endpoint — a module under a transport directory may export only \`export const NAME = ${legal.join(' / ')}(…)\`, because everything else has no client form`,
                what.start,
            )
        }

        const name = lexer.next()
        if (name === null) break
        let equals = lexer.next()
        // A type annotation is SKIPPED rather than read: nothing here needs the type, and an
        // endpoint naming its own — `export const rooms: RoomChannel<…> = socket(…)` — is ordinary
        // authoring, forced whenever a declaration's options mention the declaration.
        if (equals !== null && equals.kind === SyntaxKind.ColonToken) {
            while (equals !== null && equals.kind !== SyntaxKind.EqualsToken) equals = lexer.next()
        }
        const method = equals === null ? null : lexer.next()
        if (equals === null || method === null) break
        if (name.kind !== SyntaxKind.Identifier || equals.kind !== SyntaxKind.EqualsToken) {
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
        endpoints.push({
            name: name.text,
            method: method.text as Method,
            streams: kind === 'rpc' ? yields(lexer) : false,
        })
    }
    return endpoints
}

/** What the browser gets: the same export names, none of the module they came from. */
export function stub(modulePath: string, kind: Kind, endpoints: Endpoint[]): string {
    const socket = kind === 'socket'
    const build = socket ? '__socket' : '__remote'
    const address = moduleAddress(modulePath, kind)
    let out = socket
        ? `import { remoteSocket as __socket } from "abide"\n`
        : `import { remote as __remote } from "abide"\n`
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
    let names = ''
    for (const endpoint of endpoints) {
        pairs.push([joinId(address, endpoint.name), endpoint.name])
        names += names === '' ? endpoint.name : `, ${endpoint.name}`
    }
    return (
        `\nimport { register as __register } from "abide/server"\n` +
        `__register(${JSON.stringify(kind)}, ${JSON.stringify(pairs)}, { ${names} })\n`
    )
}
