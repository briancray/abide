// What counts as an ENDPOINT is decided syntactically — the same rule the template compiler already
// lives by, and for the same reason: the emit path must not need a type-checker, because the browser
// lane has to produce the stub from a file whose body it is about to throw away.
//
// The rule is one shape, and which declarations are legal comes from the DIRECTORY:
//
//     server/rpc/users.ts       export const NAME = GET(…)     // …or POST / PUT / PATCH / DELETE
//     server/sockets/feed.ts    export const NAME = socket(…)
//
// A `socket` under `server/rpc/` is an error naming both the file and the export. That check only
// exists because the directory says what the file is meant to be — with a filename suffix there was
// nothing to disagree with, so a socket in an rpc module was simply a socket.
//
// Anything else exported is a compile error naming the export. That is deliberate: the alternative
// is a stub that exports `undefined` for a helper somebody imported, which fails in the browser, at
// a call site, with no mention of the file that dropped it.
//
// Type-only exports are skipped rather than rejected — they are erased before either lane runs, so
// there is nothing to stub and nothing to serve.

import { SyntaxKind } from 'typescript/unstable/ast'
import { Lexer } from '$compiler/internal/lex.ts'
import type { Kind } from './ids.ts'

export const RPC_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const SOCKET_METHODS = ['socket'] as const

export type Method = (typeof RPC_METHODS)[number] | (typeof SOCKET_METHODS)[number]

const LEGAL: Record<Kind, ReadonlySet<string>> = {
    rpc: new Set<string>(RPC_METHODS),
    socket: new Set<string>(SOCKET_METHODS),
}

export interface Endpoint {
    name: string
    method: Method
}

export class ElisionError extends Error {
    constructor(
        message: string,
        readonly position: number,
    ) {
        super(message)
        this.name = 'AbideElisionError'
    }
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
                `abide: ${filename} exports \`${what.text}\`, which is not an endpoint — a module under a transport directory may export only \`export const NAME = ${[...legal].join(' / ')}(…)\`, because everything else has no client form`,
                what.start,
            )
        }

        const name = lexer.next()
        const equals = lexer.next()
        const method = lexer.next()
        if (name === null || equals === null || method === null) break
        if (name.kind !== SyntaxKind.Identifier || equals.kind !== SyntaxKind.EqualsToken) {
            throw new ElisionError(
                `abide: ${filename} exports \`${name.text}\`, which is not an endpoint — expected \`export const ${name.text} = ${[...legal][0]}(…)\``,
                name.start,
            )
        }
        if (!legal.has(method.text)) {
            throw new ElisionError(
                `abide: ${filename} declares \`${name.text}\` with \`${method.text}\`, but a ${kind} module may only declare ${[...legal].join(' / ')} — move it, or change it`,
                method.start,
            )
        }
        endpoints.push({ name: name.text, method: method.text as Method })
    }
    return endpoints
}
