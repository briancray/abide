// The shape of an endpoint as the real CHECKER sees it, for the types syntax alone cannot read.
//
// `shape.ts` derives from tokens: fast, pure, runs in every lane, and stops where a type has to be
// COMPUTED — `Omit<User, 'id'>`, a conditional, a mapped type, an `enum`, a generic alias. Those are
// not a filesystem problem the way an import was; no amount of text resolves them, because resolving
// them is what a checker IS. So this is the second speed, and it is deliberately a separate process:
//
//   * TypeScript 7's checker is the native `tsgo` binary behind a synchronous RPC channel, and that
//     channel reads `stdout._handle.fd` — a Node internal Bun does not expose. Under Bun it throws.
//   * So this file runs under NODE, and the file it runs is limited to TypeScript that Node can strip
//     rather than transform: no parameter properties, no enums, no namespaces. That is why it holds
//     its own converter instead of importing the compiler, which uses all three.
//
// It knows nothing about abide. It is handed files and export names and hands back JSON Schema, so
// the address scheme, the directory rule and the endpoint syntax all stay in one place — `elide.ts` —
// and this cannot drift from them by having its own opinion.
//
// Read on stdin, written on stdout: `{ tsconfig, endpoints: [{ id, file, name, kind }] }` in,
// `{ [id]: { input?, output? } }` out.

import type { Node } from 'typescript/unstable/ast'
// Imported TYPE-ONLY, which is what makes it free here: Node strips a type import rather than
// resolving it, so this file never loads the module it is typed against and the one place that
// touches an `unstable` surface is still checked against it.
import type { Checker, Type } from 'typescript/unstable/sync'
import type { JsonSchema, Shapes } from '$shared/internal/shapes.ts'
// The one place both derivations agree, reached RELATIVELY because Node resolves no alias — and it
// holds no runtime import of its own for the same reason.
import { ANYTHING, arrayOf, formatOf, INTRINSICS, isAnything, NOTHING, objectOf, union } from './assemble.ts'

/** `SymbolFlags.Optional`. Spelled out because the enum is not on the API's public surface. */
const OPTIONAL = 1 << 24

/** How deep a type is followed before it is more detail than a caller reading a document wants. */
const MAX_DEPTH = 12

/**
 * `intrinsicName` lives on `IntrinsicType` alone, and `Type` is the union of every kind — so asking
 * for it means saying so once here rather than narrowing at each of the four places that ask.
 */
function intrinsicNameOf(type: Type): string | undefined {
    return (type as { intrinsicName?: string }).intrinsicName
}

/** A declarator, reduced to the one member this needs off it. */
interface Named {
    name?: (Node & { text?: string }) | undefined
}

interface Job {
    tsconfig: string
    cwd: string
    endpoints: { id: string; file: string; name: string; kind: 'rpc' | 'socket' }[]
}

/**
 * One type as a shape.
 *
 * `seen` is by type IDENTITY rather than by name: a recursive type is ordinary — a comment with a
 * list of replies — and the checker hands back the same type object for it, so the cycle is visible
 * without needing to name anything.
 */
function schemaOf(checker: Checker, type: Type, seen: Set<number>, depth: number): JsonSchema {
    if (type === undefined || type === null || depth > MAX_DEPTH) return ANYTHING
    if (type.isErrorType()) return ANYTHING

    // Intrinsics FIRST. `getPropertiesOfType` on a `number` hands back Number's own members, so
    // asking about properties before asking what it is publishes `toFixed` as a field.
    const intrinsic = intrinsicOf(type)
    if (intrinsic !== null) return intrinsic

    if (type.isStringLiteralType()) return { type: 'string', const: type.value }
    if (type.isNumberLiteralType()) return { type: 'number', const: type.value }
    // The VALUE, not the intrinsic name: a boolean literal carries `true`/`false` there, and
    // reading the name instead published `const: false` for every one of them.
    if (type.isBooleanLiteralType()) return { type: 'boolean', const: type.value === true }

    if (type.isUnionType()) return unionOf(checker, type.getTypes(), seen, depth)

    // The values that are a string once they cross, named by their own symbol — from the same table
    // the token pass reads, so neither can invent a format the other does not know.
    const named = formatOf(type.getSymbol()?.name)
    if (named !== null) return named

    if (checker.isArrayLikeType(type)) return itemsOf(checker, type, seen, depth)

    if (seen.has(type.id)) return ANYTHING
    seen.add(type.id)
    try {
        return membersOf(checker, type, seen, depth)
    } finally {
        seen.delete(type.id)
    }
}

/**
 * A keyword as a schema, from the SAME table the token pass reads.
 *
 * A switch here meant the two halves each held their own answer for `object`, `symbol` and `never` —
 * and where this one had no case, the walk fell through to `getPropertiesOfType`, which is how a
 * bare `object` came out described rather than unknown.
 */
function intrinsicOf(type: Type): JsonSchema | null {
    const name = intrinsicNameOf(type)
    if (name === undefined) return null
    const found = INTRINSICS[name]
    return found === undefined ? null : { ...found }
}

/**
 * An array, or a TUPLE — which is an array of every position it holds and not of its first.
 *
 * Reading only `getTypeArguments()[0]` published `[string, number]` as an array of strings, which
 * refuses a correct call. That is an over-constraint, the one direction a derived shape may not be
 * wrong in, and it is the kind of thing having two of these produced.
 */
function itemsOf(checker: Checker, type: Type, seen: Set<number>, depth: number): JsonSchema {
    if (!type.isTypeReference()) return arrayOf(ANYTHING)
    const parts: JsonSchema[] = []
    for (const argument of checker.getTypeArguments(type)) {
        parts.push(schemaOf(checker, argument, seen, depth + 1))
    }
    return arrayOf(union(parts))
}

/**
 * A union's PARTS. What to make of them is `assemble.union`'s, so both derivations spell one the
 * same way — a `NOTHING` member is dropped here because what it means is that the MEMBER holding
 * this type is optional, which JSON Schema says by leaving a name out of `required`.
 */
function unionOf(checker: Checker, members: readonly Type[], seen: Set<number>, depth: number): JsonSchema {
    const parts: JsonSchema[] = []
    for (const one of members) {
        const name = intrinsicNameOf(one)
        if (name !== undefined && NOTHING.has(name)) continue
        parts.push(schemaOf(checker, one, seen, depth + 1))
    }
    return union(parts)
}

function membersOf(checker: Checker, type: Type, seen: Set<number>, depth: number): JsonSchema {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const property of checker.getPropertiesOfType(type)) {
        // A method carries no JSON, so it is not a member of the shape.
        const held = checker.getTypeOfSymbol(property)
        if (held === undefined) continue
        if (checker.getSignaturesOfType(held, 0).length > 0) continue
        properties[property.name] = schemaOf(checker, held, seen, depth + 1)
        if ((property.flags & OPTIONAL) === 0) required.push(property.name)
    }
    const index = checker.getIndexInfosOfType(type)[0]
    const additional = index === undefined ? undefined : schemaOf(checker, index.valueType, seen, depth + 1)
    return objectOf(properties, required, additional)
}

/**
 * The two type arguments a declaration carries.
 *
 * An rpc IS a `Rpc<Args, T>` and a socket IS a `Channel<T>` or a `KeyedChannel<Args, T>`, so the
 * declaration's own TYPE says both directions without anything here having to find the handler,
 * unwrap a generator, or know what `GET` means.
 */
function shapesFor(checker: Checker, type: Type | undefined, kind: 'rpc' | 'socket'): Shapes {
    if (type === undefined || !type.isTypeReference()) return {}
    const name = type.getSymbol()?.name
    const args = checker.getTypeArguments(type)
    const seen = new Set<number>()
    const at = (index: number): JsonSchema => {
        const held = args[index]
        return held === undefined ? ANYTHING : schemaOf(checker, held, seen, 0)
    }
    if (kind === 'socket') {
        // A room channel addresses subscribers by its FIRST argument and carries its second.
        const schema = at(name === 'KeyedChannel' ? 1 : 0)
        return isAnything(schema) ? {} : { input: schema }
    }
    const input = at(0)
    const output = at(1)
    const shapes: Shapes = {}
    if (!isAnything(input)) shapes.input = input
    if (!isAnything(output)) shapes.output = output
    return shapes
}

async function main(): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const job = JSON.parse(Buffer.concat(chunks).toString()) as Job

    const { API } = await import('typescript/unstable/sync')
    const api = new API({ cwd: job.cwd })
    const out: Record<string, Shapes> = {}
    try {
        const snapshot = api.updateSnapshot({ openProjects: [job.tsconfig] })
        const project = snapshot.getProjects()[0]
        if (project === undefined) throw new Error(`abide: no project at ${job.tsconfig}`)
        const { program, checker } = project

        // Grouped by file so each source is walked once however many endpoints it declares.
        const byFile = new Map<string, Job['endpoints']>()
        for (const endpoint of job.endpoints) {
            const held = byFile.get(endpoint.file)
            if (held === undefined) byFile.set(endpoint.file, [endpoint])
            else held.push(endpoint)
        }

        for (const [file, endpoints] of byFile) {
            const source = program.getSourceFile(file)
            if (source === undefined) continue
            // Narrowed by SHAPE rather than by kind: the AST's statement union is wide, an endpoint
            // is always `export const NAME = …`, and the one thing needed off it is the name node to
            // ask the checker about.
            const declarations = new Map<string, Node>()
            for (const statement of source.statements) {
                const list = (statement as { declarationList?: { declarations?: readonly Named[] } })
                    .declarationList
                for (const declaration of list?.declarations ?? []) {
                    const name = declaration.name
                    if (typeof name?.text === 'string') declarations.set(name.text, name)
                }
            }
            for (const endpoint of endpoints) {
                const at = declarations.get(endpoint.name)
                if (at === undefined) continue
                const symbol = checker.getSymbolAtLocation(at)
                if (symbol === undefined) continue
                const shapes = shapesFor(checker, checker.getTypeOfSymbol(symbol), endpoint.kind)
                if (shapes.input !== undefined || shapes.output !== undefined) out[endpoint.id] = shapes
            }
        }
    } finally {
        api.close()
    }
    process.stdout.write(JSON.stringify(out))
}

await main()
