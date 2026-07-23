// TS7 TYPE -> JSON-SCHEMA DERIVATION (M8b, rpc-core §11).
//
// Given a source file and the name of an exported RPC handler, resolve the handler's *function*
// (unwrapping helper wrappers like `GET((args) => ...)`), then map its single parameter type to an
// input JSON Schema and its return type (Promise-unwrapped) to an output JSON Schema. Unrepresentable
// types (functions, unbounded generics, symbols) do not fail — they emit a permissive `{}` and push a
// LOUD warning naming the type and field (loud-not-silent, §11.3).
//
// RUNTIME NOTE / API LIMITATION: this uses TypeScript 7's *sync* programmatic API
// (`typescript/unstable/sync`). That API spawns the `tsgo` engine and talks to it over a synchronous
// pipe using Node's internal `stdout._handle.fd`, which Bun does not expose — instantiating `API`
// under Bun throws `undefined is not an object (evaluating 'stdout._handle.fd')`. So when this module
// runs under Bun we shell out to `node` running THIS SAME FILE as a script (Node >= 23 strips the
// types), do the derivation in-process there, and read the JSON result back. Under Node the work
// happens directly in-process. Everything the checker exposes works fine — the only limitation is the
// transport, hence the subprocess bridge.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Node } from 'typescript/unstable/ast'
import {
    isArrowFunction,
    isCallExpression,
    isExportAssignment,
    isFunctionDeclaration,
    isFunctionExpression,
    isVariableDeclaration,
} from 'typescript/unstable/ast/is'
import type {
    Checker,
    Project,
    Signature,
    Symbol as TSSymbol,
    Type,
} from 'typescript/unstable/sync'
import { API, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'
import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'

export type DeriveSchemaResult = { input?: JSONSchema; output?: JSONSchema; warnings: string[] }

// How deep to descend into nested object/array types before giving up. Recursive types are also
// guarded by an on-stack `seen` set of type ids; this bounds merely-deep (non-recursive) types.
const MAX_DEPTH = 24

// Marker the subprocess prints so the Bun-side parent can find the JSON result line even if tsgo or
// something else writes to stdout.
const RESULT_MARKER = '__ABIDE_DERIVE_RESULT__:'

export function deriveSchema(filePath: string, exportName: string): DeriveSchemaResult {
    // Under Bun the sync TS API cannot open its pipe (see file header) — bridge through Node.
    const bun = (globalThis as { Bun?: unknown }).Bun
    if (bun !== undefined) return deriveViaNodeSubprocess(filePath, exportName)
    return deriveInProcess(filePath, exportName)
}

function deriveViaNodeSubprocess(filePath: string, exportName: string): DeriveSchemaResult {
    const self = fileURLToPath(import.meta.url)
    const spawnSync = (
        globalThis as {
            Bun: {
                spawnSync: (
                    cmd: string[],
                    opts?: unknown,
                ) => {
                    stdout: { toString(): string }
                    stderr: { toString(): string }
                    success: boolean
                }
            }
        }
    ).Bun.spawnSync
    const proc = spawnSync(['node', self, filePath, exportName], { stdout: 'pipe', stderr: 'pipe' })
    const stdout = proc.stdout.toString()
    const markerAt = stdout.lastIndexOf(RESULT_MARKER)
    if (markerAt === -1) {
        const stderr = proc.stderr.toString().trim()
        return {
            warnings: [
                `deriveSchema: Node subprocess produced no result${stderr ? ` (stderr: ${stderr})` : ''}`,
            ],
        }
    }
    const jsonStart = markerAt + RESULT_MARKER.length
    const jsonEnd = stdout.indexOf('\n', jsonStart)
    const json = stdout.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd)
    return JSON.parse(json) as DeriveSchemaResult
}

function deriveInProcess(filePath: string, exportName: string): DeriveSchemaResult {
    const api = new API({ cwd: findProjectRoot(filePath) })
    try {
        const project = api
            .updateSnapshot({ openFiles: [filePath] })
            .getDefaultProjectForFile(filePath)
        if (project === undefined) {
            return { warnings: [`deriveSchema: no TypeScript project found for ${filePath}`] }
        }
        return deriveExportFromProject(project, filePath, exportName)
    } finally {
        api.close()
    }
}

// One export-name in an already-open project → its {input, output} JSON Schema. Shared by the single
// (`deriveInProcess`) and batch (`deriveBatchInProcess`) paths so the derivation rules stay identical.
function deriveExportFromProject(
    project: Project,
    filePath: string,
    exportName: string,
): DeriveSchemaResult {
    const warnings: string[] = []
    const result: DeriveSchemaResult = { warnings }
    const checker = project.checker
    const sourceFile = project.program.getSourceFile(filePath)
    if (sourceFile === undefined) {
        warnings.push(`deriveSchema: source file ${filePath} is not part of the project`)
        return result
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) {
        warnings.push(`deriveSchema: ${filePath} is not a module (no exports)`)
        return result
    }
    const exported = checker
        .getExportsOfModule(moduleSymbol)
        .find((symbol) => symbol.name === exportName)
    if (exported === undefined) {
        warnings.push(`deriveSchema: export "${exportName}" not found in ${filePath}`)
        return result
    }
    const signature = findHandlerSignature(exported, checker, project)
    if (signature === undefined) {
        warnings.push(
            `deriveSchema: export "${exportName}" is not callable — cannot derive a schema`,
        )
        return result
    }

    const parameters = signature.getParameters()
    const firstParameter = parameters[0]
    if (firstParameter !== undefined) {
        const inputType = checker.getTypeOfSymbol(firstParameter)
        if (inputType !== undefined) {
            result.input = typeToSchema(inputType, checker, warnings, new Set<number>(), 0, '')
        }
    }

    const returnType = checker.getReturnTypeOfSignature(signature)
    if (returnType !== undefined) {
        const outputSchema = deriveOutputSchema(returnType, checker, warnings)
        if (outputSchema !== undefined) result.output = outputSchema
    }
    return result
}

// §11.4 output derivation: reduce a handler's return type to the schema of its SUCCESS PAYLOAD.
// `json(T)`/`TypedResponse<T>` → `T`; `jsonl(C)`/`sse(C)`/`StreamResponse<C>` → element `C`; a bare
// `Response` (what `redirect()`/`error()`/`error.typed()` return) carries no success payload and is
// dropped; `void`/`undefined` likewise. A union maps member-by-member with the same rules, so a
// `TypedResponse<T> | Response` (value-or-typed-error) collapses to `T`. Returns undefined when nothing
// remains (e.g. a redirect-only handler) — then no output schema is merged and no shaping happens.
function deriveOutputSchema(
    returnType: Type,
    checker: Checker,
    warnings: string[],
): JSONSchema | undefined {
    const settled = unwrapPromise(returnType, checker)
    const members = settled.isUnionType() ? settled.getTypes() : [settled]
    const schemas: JSONSchema[] = []
    for (const member of members) {
        if ((member.flags & (TypeFlags.Void | TypeFlags.Undefined)) !== 0) continue
        const payload = unwrapResponseWrapper(member, checker)
        if (payload === undefined) continue // a bare Response member (redirect/error) — no payload
        if ((payload.flags & (TypeFlags.Void | TypeFlags.Undefined)) !== 0) continue
        schemas.push(typeToSchema(payload, checker, warnings, new Set<number>(), 0, ''))
    }
    if (schemas.length === 0) return undefined
    if (schemas.length === 1) return schemas[0]
    return { anyOf: schemas }
}

// One return-type member → its payload Type, or undefined when it is a non-payload Response.
// `TypedResponse<T>`/`StreamResponse<C>` are detected by their brand property (a unique-symbol member
// whose name carries `VALUE_BRAND`/`CHUNK_BRAND`); a plain data type passes through unchanged.
function unwrapResponseWrapper(type: Type, checker: Checker): Type | undefined {
    const valueBrand = brandPropertyType(type, 'VALUE_BRAND', checker)
    if (valueBrand !== undefined) return valueBrand
    const chunkBrand = brandPropertyType(type, 'CHUNK_BRAND', checker)
    if (chunkBrand !== undefined) return chunkBrand
    if (isResponseLike(type, checker)) return undefined
    return type
}

// The type argument carried by a TypedResponse/StreamResponse brand property, if present.
function brandPropertyType(type: Type, brand: string, checker: Checker): Type | undefined {
    for (const property of checker.getPropertiesOfType(type)) {
        if (property.name.includes(brand)) return checker.getTypeOfSymbol(property)
    }
    return undefined
}

// A bare `Response` (or a typed-error `Response & { __typedErrorName }`) — structurally, the fetch
// `Response` shape. Checked AFTER the brand probes, so a TypedResponse/StreamResponse (which also
// extends Response) has already been unwrapped and never reaches here.
function isResponseLike(type: Type, checker: Checker): boolean {
    if (type.getSymbol()?.name === 'Response') return true
    const names = new Set(checker.getPropertiesOfType(type).map((property) => property.name))
    return (
        names.has('status') &&
        names.has('ok') &&
        names.has('headers') &&
        names.has('body') &&
        names.has('arrayBuffer')
    )
}

// A batch derivation entry: a stable `key` (the caller's RPC route name) plus the file + export to
// derive. `deriveSchemas` returns a `key → result` map.
export type DeriveEntry = { key: string; filePath: string; exportName: string }

// Batch-derive many exports in ONE type-engine session (grouped by tsconfig project root), so a whole
// app's RPCs cost a single tsgo project load instead of N subprocess spawns. Same Bun→Node bridge as
// the single path.
export function deriveSchemas(entries: DeriveEntry[]): Record<string, DeriveSchemaResult> {
    if (entries.length === 0) return {}
    const bun = (globalThis as { Bun?: unknown }).Bun
    return bun !== undefined ? deriveBatchViaNodeSubprocess(entries) : deriveBatchInProcess(entries)
}

function deriveBatchInProcess(entries: DeriveEntry[]): Record<string, DeriveSchemaResult> {
    const out: Record<string, DeriveSchemaResult> = {}
    // Group by project root so each tsconfig project is loaded once and reused across its RPCs.
    const byRoot = new Map<string, DeriveEntry[]>()
    for (const entry of entries) {
        const root = findProjectRoot(entry.filePath)
        const group = byRoot.get(root)
        if (group === undefined) byRoot.set(root, [entry])
        else group.push(entry)
    }
    for (const [root, group] of byRoot) {
        const api = new API({ cwd: root })
        try {
            const snapshot = api.updateSnapshot({ openFiles: group.map((entry) => entry.filePath) })
            for (const entry of group) {
                const project = snapshot.getDefaultProjectForFile(entry.filePath)
                out[entry.key] =
                    project === undefined
                        ? {
                              warnings: [
                                  `deriveSchema: no TypeScript project found for ${entry.filePath}`,
                              ],
                          }
                        : deriveExportFromProject(project, entry.filePath, entry.exportName)
            }
        } finally {
            api.close()
        }
    }
    return out
}

function deriveBatchViaNodeSubprocess(entries: DeriveEntry[]): Record<string, DeriveSchemaResult> {
    const self = fileURLToPath(import.meta.url)
    const spawnSync = (
        globalThis as {
            Bun: {
                spawnSync: (
                    cmd: string[],
                    opts?: unknown,
                ) => {
                    stdout: { toString(): string }
                    stderr: { toString(): string }
                    success: boolean
                }
            }
        }
    ).Bun.spawnSync
    const proc = spawnSync(['node', self, '--batch'], {
        stdin: Buffer.from(JSON.stringify(entries)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const stdout = proc.stdout.toString()
    const markerAt = stdout.lastIndexOf(RESULT_MARKER)
    if (markerAt === -1) {
        const stderr = proc.stderr.toString().trim()
        const warning = `deriveSchema: batch Node subprocess produced no result${stderr ? ` (stderr: ${stderr})` : ''}`
        const out: Record<string, DeriveSchemaResult> = {}
        for (const entry of entries) out[entry.key] = { warnings: [warning] }
        return out
    }
    const jsonStart = markerAt + RESULT_MARKER.length
    const jsonEnd = stdout.indexOf('\n', jsonStart)
    const json = stdout.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd)
    return JSON.parse(json) as Record<string, DeriveSchemaResult>
}

// The exported binding may be the function itself (`export const fn = (a) => ...`), a wrapped handler
// (`export const fn = GET((a) => ...)`, incl. `export default GET(...)`), or a function declaration.
// Walk the value declaration to the innermost function-like node and take ITS call signature, so
// wrappers don't hide the real shape.
function findHandlerSignature(
    symbol: TSSymbol,
    checker: Checker,
    project: Project,
): Signature | undefined {
    const declaration = symbol.valueDeclaration?.resolve(project)
    if (declaration !== undefined) {
        const functionNode = findFunctionNode(declaration)
        if (functionNode !== undefined) {
            const signature = checker.getSignatureFromDeclaration(functionNode)
            if (signature !== undefined) return signature
        }
    }
    // Fallback: read call signatures off the binding's type (covers exports whose value declaration we
    // could not resolve to a literal function).
    const type = checker.getTypeOfSymbol(symbol)
    if (type !== undefined) {
        const signatures = checker.getSignaturesOfType(type, SignatureKind.Call)
        const firstSignature = signatures[0]
        if (firstSignature !== undefined) return firstSignature
    }
    return undefined
}

function findFunctionNode(node: Node): Node | undefined {
    if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node))
        return node
    if (isVariableDeclaration(node)) {
        return node.initializer === undefined ? undefined : findFunctionNode(node.initializer)
    }
    // `export default GET(...)` — the value declaration is the ExportAssignment; unwrap to its
    // expression so a default-exported wrapped handler resolves like a named one.
    if (isExportAssignment(node)) {
        return findFunctionNode(node.expression)
    }
    if (isCallExpression(node)) {
        for (const argument of node.arguments) {
            const found = findFunctionNode(argument)
            if (found !== undefined) return found
        }
    }
    return undefined
}

function unwrapPromise(type: Type, checker: Checker): Type {
    let current = type
    // Unwrap nested Promise<...> (and Promise-like via symbol name) down to the settled value type.
    for (let i = 0; i < 8; i++) {
        if (current.getSymbol()?.name === 'Promise' && current.isTypeReference()) {
            const args = checker.getTypeArguments(current)
            if (args.length > 0 && args[0] !== undefined) {
                current = args[0]
                continue
            }
        }
        break
    }
    return current
}

function typeToSchema(
    type: Type,
    checker: Checker,
    warnings: string[],
    seen: Set<number>,
    depth: number,
    fieldPath: string,
): JSONSchema {
    const where = fieldPath === '' ? '<root>' : `"${fieldPath}"`
    if (depth > MAX_DEPTH) {
        warnings.push(
            `deriveSchema: type at ${where} is nested too deeply (> ${MAX_DEPTH}); emitted permissive {}`,
        )
        return {}
    }

    const flags = type.flags

    // `unknown` = "no declared contract" (a zero-arg read's absent input, or an intentionally-open
    // value) → permissive, silent. `any` is different: it marks an UNTYPED position — a param with
    // neither an annotation nor an inferable default, or an explicit `any`. Still permissive, but LOUD
    // (§11.3): left silent it drops the field from every derived contract (OpenAPI/MCP/CLI) with no
    // trace. Distinguishing the two is what lets an unannotated handler with defaults derive cleanly
    // while a genuinely untyped param gets called out.
    if ((flags & TypeFlags.Unknown) !== 0) return {}
    if ((flags & TypeFlags.Any) !== 0) {
        warnings.push(
            `deriveSchema: type at ${where} is \`any\` — no schema constraint derived; annotate it, give it a default, or pass a schema`,
        )
        return {}
    }
    if ((flags & TypeFlags.Null) !== 0) return { type: 'null' }
    // A bare undefined/void where a schema is required maps to permissive (unions filter these out).
    if ((flags & (TypeFlags.Undefined | TypeFlags.Void)) !== 0) return {}
    // never matches nothing.
    if ((flags & TypeFlags.Never) !== 0) return { not: {} }

    // Literals first — a literal also carries StringLike/NumberLike flags, so check before the generic
    // primitive branches.
    if (type.isStringLiteralType()) return { type: 'string', const: type.value }
    if (type.isNumberLiteralType()) return { type: 'number', const: type.value }
    if (type.isBooleanLiteralType()) return { type: 'boolean', const: type.value }

    // `boolean` is internally a union of the `true`/`false` literals, so it must precede union handling.
    if ((flags & TypeFlags.Boolean) !== 0) return { type: 'boolean' }
    if ((flags & TypeFlags.Number) !== 0) return { type: 'number' }
    if ((flags & TypeFlags.String) !== 0) return { type: 'string' }
    // JSON has no bigint; the closest representable shape is an integer.
    if ((flags & TypeFlags.BigInt) !== 0) return { type: 'integer' }

    if ((flags & TypeFlags.ESSymbol) !== 0 || (flags & TypeFlags.UniqueESSymbol) !== 0) {
        warnings.push(
            `deriveSchema: symbol type at ${where} is not representable in JSON Schema; emitted permissive {}`,
        )
        return {}
    }

    if (type.isUnionType()) {
        return unionToSchema(type, checker, warnings, seen, depth, fieldPath)
    }

    if (type.isObjectType()) {
        return objectToSchema(type, checker, warnings, seen, depth, fieldPath)
    }

    if (type.isTypeParameter()) {
        warnings.push(
            `deriveSchema: unbounded generic type parameter "${checker.typeToString(type)}" at ${where} is not representable; emitted permissive {}`,
        )
        return {}
    }

    warnings.push(
        `deriveSchema: type "${checker.typeToString(type)}" at ${where} is not representable in JSON Schema; emitted permissive {}`,
    )
    return {}
}

function unionToSchema(
    type: Type,
    checker: Checker,
    warnings: string[],
    seen: Set<number>,
    depth: number,
    fieldPath: string,
): JSONSchema {
    if (!type.isUnionType()) return {}
    // Drop undefined/void constituents — they encode optionality, handled by the containing object.
    const members = type
        .getTypes()
        .filter((member) => (member.flags & (TypeFlags.Undefined | TypeFlags.Void)) === 0)

    const firstMember = members[0]
    if (firstMember === undefined) return {}
    if (members.length === 1)
        return typeToSchema(firstMember, checker, warnings, seen, depth, fieldPath)

    // A union of pure literals collapses to an enum of their values.
    const allLiteral = members.every((member) => member.isLiteralType())
    if (allLiteral) {
        const values: unknown[] = []
        for (const member of members) {
            if (member.isLiteralType()) values.push(member.value)
        }
        return { enum: values }
    }

    const anyOf: JSONSchema[] = []
    for (const member of members) {
        anyOf.push(typeToSchema(member, checker, warnings, seen, depth + 1, fieldPath))
    }
    return { anyOf }
}

function objectToSchema(
    type: Type,
    checker: Checker,
    warnings: string[],
    seen: Set<number>,
    depth: number,
    fieldPath: string,
): JSONSchema {
    const where = fieldPath === '' ? '<root>' : `"${fieldPath}"`

    // Date -> ISO date-time string.
    if (type.getSymbol()?.name === 'Date') return { type: 'string', format: 'date-time' }

    // Array<T> -> { type: "array", items: schema(T) }.
    if (checker.isArrayType(type) && type.isTypeReference()) {
        const args = checker.getTypeArguments(type)
        const element = args[0]
        const items =
            element === undefined
                ? {}
                : typeToSchema(
                      element,
                      checker,
                      warnings,
                      seen,
                      depth + 1,
                      fieldPath === '' ? '[]' : `${fieldPath}[]`,
                  )
        return { type: 'array', items }
    }

    // Tuple [A, B, ...] -> positional prefixItems with a fixed length. (The shared JSONSchema type's
    // `items` is a single schema, so tuples use `prefixItems`, which the runtime validator tolerates.)
    if (checker.isTupleType(type) && type.isTypeReference()) {
        const args = checker.getTypeArguments(type)
        const prefixItems: JSONSchema[] = []
        for (const [i, argument] of args.entries()) {
            prefixItems.push(
                typeToSchema(
                    argument,
                    checker,
                    warnings,
                    seen,
                    depth + 1,
                    fieldPath === '' ? `[${i}]` : `${fieldPath}[${i}]`,
                ),
            )
        }
        return { type: 'array', prefixItems, minItems: args.length, maxItems: args.length }
    }

    const callSignatures = checker.getSignaturesOfType(type, SignatureKind.Call)
    const constructSignatures = checker.getSignaturesOfType(type, SignatureKind.Construct)
    const properties = checker.getPropertiesOfType(type)

    // A callable/constructable object with no data properties is a function/constructor — unrepresentable.
    if (properties.length === 0 && (callSignatures.length > 0 || constructSignatures.length > 0)) {
        const kind = callSignatures.length > 0 ? 'function' : 'constructor'
        warnings.push(
            `deriveSchema: ${kind} type "${checker.typeToString(type)}" at ${where} is not representable in JSON Schema; emitted permissive {}`,
        )
        return {}
    }

    // Break cycles on recursive/self-referential object types.
    if (seen.has(type.id)) return {}
    seen.add(type.id)

    const schemaProperties: Record<string, JSONSchema> = {}
    const required: string[] = []
    for (const property of properties) {
        const propertyType = checker.getTypeOfSymbol(property)
        const childPath = fieldPath === '' ? property.name : `${fieldPath}.${property.name}`
        if (propertyType === undefined) {
            warnings.push(
                `deriveSchema: could not resolve the type of property "${childPath}"; emitted permissive {}`,
            )
            schemaProperties[property.name] = {}
        } else {
            schemaProperties[property.name] = typeToSchema(
                propertyType,
                checker,
                warnings,
                seen,
                depth + 1,
                childPath,
            )
        }
        if ((property.flags & SymbolFlags.Optional) === 0) required.push(property.name)
    }

    seen.delete(type.id)

    const schema: JSONSchema = { type: 'object', properties: schemaProperties }
    if (required.length > 0) schema.required = required
    return schema
}

function findProjectRoot(filePath: string): string {
    let directory = dirname(filePath)
    for (let i = 0; i < 64; i++) {
        if (existsSync(join(directory, 'tsconfig.json'))) return directory
        const parent = dirname(directory)
        if (parent === directory) break
        directory = parent
    }
    return process.cwd()
}

// When executed directly by Node (the Bun-side bridge above), read args and print the JSON result.
// `--batch` reads a JSON `DeriveEntry[]` from stdin and prints a `key → result` map; otherwise the
// two positional args are a single `<filePath> <exportName>`.
if (import.meta.main) {
    if (process.argv[2] === '--batch') {
        const chunks: Buffer[] = []
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
        const entries = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DeriveEntry[]
        const derived = deriveBatchInProcess(entries)
        process.stdout.write(`${RESULT_MARKER}${JSON.stringify(derived)}\n`)
    } else {
        const filePath = process.argv[2]
        const exportName = process.argv[3]
        if (filePath === undefined || exportName === undefined) {
            process.stderr.write('usage: node deriveSchema.ts <filePath> <exportName>\n')
            process.exit(2)
        }
        const derived = deriveInProcess(filePath, exportName)
        process.stdout.write(`${RESULT_MARKER}${JSON.stringify(derived)}\n`)
    }
}
