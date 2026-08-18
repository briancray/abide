// The one shape language, declared once so the compiler and the runtime cannot disagree about it.
//
// JSON Schema is abide's NATIVE representation rather than a projection of something else, and the
// reason is that the projection has to go the other way. Standard Schema — the interop spec zod,
// valibot and arktype all answer to — is validate-only: it hands over a `validate` function and
// nothing that says what the shape IS, so a schema declared through it cannot be turned into a tool
// definition, an OpenAPI document, or anything else a machine reads BEFORE it calls. A shape abide
// can only run is a shape abide cannot publish.
//
// So the order is inverted: JSON Schema is what a declaration means, a library schema is an
// alternative VALIDATOR over the same call, and the compiler derives JSON Schema from the type
// annotation when nobody declared one. Every door — the wire, MCP, an OpenAPI generator — reads the
// same object.
//
// The keywords are ENUMERATED rather than left open, and that is load-bearing twice: it makes
// `JsonSchema` a weak type, so a library schema handed to the same option is a type error here
// instead of being silently accepted as a schema with no keywords in it, and it is the list the
// validator below actually understands. A declaration that needs a keyword abide has no opinion
// about says so with a cast, which is a caller asserting something rather than abide pretending.
//
// Types only. The compiler imports this type-only, exactly as it imports `Kind`, so nothing about
// the runtime reaches the emit path.

/**
 * Which law a declaration is. The DIRECTORY it lives in is what says so.
 *
 * Declared on the leaf both lanes and the compiler already read type-only, and re-exported from
 * `transport.ts` under the name the public surface uses. One declaration because, as `elide.ts` puts
 * it, a `Kind` declared twice is a rename that compiles on both sides and fails on the wire.
 */
export type Kind = 'rpc' | 'socket'

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

// The fields a DERIVED schema is built with take an explicit `undefined` as well as being optional —
// the four `objectOf` writes and the `items` `arrayOf` writes: under `exactOptionalPropertyTypes`
// those are different types, and each constructor writes all of its own so that every schema it
// derives is one hidden class for the per-member and per-alternative walks in `assemble.ts`. Stated
// for objects alone once, and `arrayOf` is the sibling that was missed when it was. Nothing at
// RUNTIME sees any of it: a schema reaches the validator through `JSON.stringify`, which drops an
// undefined value.
export interface JsonSchema {
    /** One type, or the several a union of them derives to. */
    type?: JsonType | JsonType[] | undefined
    /** Object members, by name. */
    properties?: Record<string, JsonSchema> | undefined
    required?: string[] | undefined
    /** `false` closes the object; a schema is the value shape of a `Record`. Unset is open. */
    additionalProperties?: boolean | JsonSchema | undefined
    items?: JsonSchema | undefined
    /** A closed set of values — what a union of literals derives to. */
    enum?: unknown[]
    const?: unknown
    /** A union that is not a set of literals. */
    anyOf?: JsonSchema[]
    oneOf?: JsonSchema[]
    allOf?: JsonSchema[]
    /**
     * `binary` is a FILE. OpenAPI's spelling, and the one entry here that is not JSON: it is what
     * makes a multipart door describable in the same document as every other call.
     */
    format?: string

    // Understood by the validator.
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    minItems?: number
    maxItems?: number

    // Carried to whoever reads the shape, and ignored when checking one.
    title?: string
    description?: string
    default?: unknown
    examples?: unknown[]
    deprecated?: boolean
}

/** What one endpoint declares in each direction. Absent where nothing was declared or derivable. */
export interface Shapes {
    input?: JsonSchema | undefined
    output?: JsonSchema | undefined
    /**
     * A keyed socket's ROOM — what selects the stream, rather than what travels on it.
     *
     * The third direction `shape.ts`'s `Declared` header anticipated, and it is here rather than
     * folded into `input` because the two are genuinely different questions: `input` is the message a
     * client sends, and this is the address it sends to. A generated surface needs both and cannot
     * infer either from the other — a tool that publishes to `feed/rooms` with no room named is a
     * tool an agent cannot call, which is what left the socket half of the surface undescribed.
     *
     * Never set on an rpc: its args ARE its input, and a second name for them would be two slots
     * holding the same answer.
     */
    room?: JsonSchema | undefined
}

/**
 * What the compiler read off ONE declaration — its shapes, plus what the SYNTAX said about them.
 *
 * The record that crosses into `register`, and it is `Shapes` plus the one fact that is not a
 * direction. A hand-written `register` sends shapes alone, which is why every member is optional.
 */
export interface Declaration extends Shapes {
    /**
     * The handler answers with a SEQUENCE — declared `function*`, or framed with `jsonl()` / `sse()`.
     *
     * Only the compiler can say the second: `() => jsonl(items())` is an ordinary arrow, so the
     * runtime's own `isGenerator` reads it as a single value and only learns better from the first
     * call's return. That left the document saying "one value" about an endpoint whose stub was
     * already decoding chunks — and the document is what a machine reads BEFORE calling.
     */
    streams?: true | undefined
}

/**
 * Which GENERATED surfaces an endpoint appears on.
 *
 * Every one, unless a declaration says otherwise — the same default the catalogue already has, and
 * for the same reason: `GET /__abide/schema` lists every address because every address is already in
 * the client bundle. What an opt-out is actually for is the endpoint whose shape is describable and
 * whose CALL is not something an agent should be handed, and that is a judgement only the app can
 * make, so it is declared rather than inferred.
 *
 * A flag PER surface rather than one `publish: false`, because the two doors are not the same risk:
 * an OpenAPI operation is a description a human reads before writing a client, and an MCP tool is a
 * call an agent may make on its own. An app that wants its mutations documented and not callable
 * says exactly that.
 */
export interface Clients {
    /** A tool on the generated MCP surface. Default true. */
    mcp?: boolean | undefined
    /** An operation in the generated OpenAPI document. Default true. */
    openapi?: boolean | undefined
}

/**
 * What a declaration that said nothing means, as one object rather than a pair rebuilt per endpoint.
 *
 * Also what `endpoints()` reads for a declaration with no policy at all — a hand-written `register`,
 * which is the seam's own escape hatch. Shared rather than restated there, because a default written
 * twice is the two doors disagreeing about what silence meant. HERE rather than beside the door that
 * first needed it, so that reading what silence means costs the type and nothing behind it.
 */
export const EVERY_CLIENT: Required<Clients> = { mcp: true, openapi: true }

/** One endpoint as a machine reads it before calling: the whole of what a tool definition needs. */
export interface EndpointShape {
    /** `users/getUser` — the address, and the natural tool name. */
    id: string
    kind: Kind
    /** The method an rpc travels as. Absent on a socket, which is an upgrade rather than a call. */
    method?: string
    description?: string
    /** The handler yields, so the answer arrives as chunks rather than at once. */
    streams?: boolean
    input?: JsonSchema
    output?: JsonSchema
    /** A keyed socket's room, as a query. Absent on an rpc and on a socket with one stream. */
    room?: JsonSchema
    /**
     * This socket accepts what a client sends, so it has a PUBLISH arm as well as a tail. Absent on
     * an rpc, and on the ordinary broadcast socket that only ever speaks outward.
     */
    clientPublish?: boolean
    /**
     * Which generated surfaces this appears on, RESOLVED — the declaration's answer with the default
     * already applied, so a projection filters rather than restating what absent means.
     */
    clients: Required<Clients>
}
