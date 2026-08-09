// A handler's TYPE, read as a shape — so an endpoint that declared no schema still publishes one.
//
// The type annotation is already there. `GET(({ id }: { id: number }) => …)` says exactly what the
// call takes, and an author who then has to restate it in a schema is being asked to write the same
// fact twice and keep the two in step by hand. So the compiler derives it, and a declared schema is
// what OVERRIDES the derivation rather than what supplies it.
//
// SYNTACTICALLY, with the same scanner everything else here uses and for the same reason: the emit
// path must not need a type-checker. What that buys is that this runs in the browser lane too, on a
// file it is about to throw away, in the same pass that writes the stub. What it costs is reach — an
// IMPORTED type cannot be resolved from one file's tokens, and neither can a generic one. Those
// derive to the empty schema, which matches everything.
//
// That is the direction the whole file leans: an unrecognised type is `{}` and never a guess. A
// derived schema is allowed to know LESS than the type does, because a shape that under-constrains
// refuses nothing the handler would have accepted; one that over-constrains refuses a call that was
// correct, and does it at a door the author never wrote.

import { SyntaxKind } from 'typescript/unstable/ast'
// Type-only, exactly like `Kind` in `elide.ts`: the emitted schema IS the contract between the two
// halves, and a shape language declared twice is a keyword that means one thing here and another
// there.
import type { JsonSchema, Shapes } from '$shared/internal/shapes.ts'
import { ANYTHING, arrayOf, formatOf, INTRINSICS, isAnything, NOTHING, objectOf, union } from './assemble.ts'
import { type Token, tokensOf } from './lex.ts'
import { IDENTIFIER } from './parse.ts'

/** One type expression, and where reading it stopped. */
interface Read {
    schema: JsonSchema
    /**
     * `undefined` or `void` was one of the alternatives, so a MEMBER holding this type is optional.
     * Carried beside the schema rather than in it, because JSON Schema says "optional" by leaving a
     * name out of `required` — it is a fact about the member, not about the shape.
     */
    optional: boolean
    at: number
}

/**
 * The text of a module, and a stable identity for it.
 *
 * A resolver is INJECTED rather than reached for, so `elide` stays what it says it is: text in, text
 * out, no filesystem. The Bun plugin hands over one that reads from disk; a demo hands over a map in
 * memory, which is what keeps the case runnable in a browser card. `path` is the cache and cycle key,
 * so two spellings of one module are one read.
 */
export interface ImportedModule {
    path: string
    text: string
}

export type TypeSource = (specifier: string, importer: string) => ImportedModule | null

/** One import binding: the local name, and what it is called where it came from. */
interface Imported {
    from: string
    exported: string
}

/**
 * The state a resolution shares across files: what has been read, and what is being read right now.
 *
 * A cycle is two modules whose types name each other, and it is ordinary — a `Book` with an `author`
 * whose module imports `Book` back. Without the guard it is a stack overflow at build time.
 */
interface Crossing {
    resolve: TypeSource
    readers: Map<string, TypeReader | null>
    active: Set<string>
    depth: number
}

/** How far a type may be followed across files before it is not worth the reads. */
const MAX_DEPTH = 8

/** Prefix operators over a type. Each takes an operand, which is what has to be consumed with it. */
const TYPE_OPERATORS = new Set(['typeof', 'keyof', 'infer', 'unique'])

/**
 * The reader. One per module, because resolving a local `type`/`interface` is a jump to another part
 * of the same token array — and because the guard against a type that names itself has to outlive
 * one call.
 */
export class TypeReader {
    /** Local `type X = …` / `interface X { … }`, by name → where its body starts, and what it extends. */
    private readonly locals = new Map<string, { body: number; bases: string[] }>()
    /** `import type { A, B as C } from '…'`, by LOCAL name. Read lazily: a module is opened only
     * when a type actually names something from it. */
    private readonly imports = new Map<string, Imported>()
    /** Names being resolved right now. A type that names itself derives to `{}` rather than hanging. */
    private readonly resolving = new Set<string>()

    constructor(
        /** Read by `shapesAt` below, which walks the same array to find the handler literal. */
        readonly tokens: Token[],
        /** What this module is, so a relative import beside it resolves and a cycle has a key. */
        readonly path = '',
        private readonly crossing: Crossing | null = null,
    ) {
        this.collect()
    }

    /** A reader over another module, built once per path however many types come from it. */
    private readerFor(specifier: string): TypeReader | null {
        const crossing = this.crossing
        if (crossing === null || crossing.depth >= MAX_DEPTH) return null
        const found = crossing.resolve(specifier, this.path)
        if (found === null) return null
        const held = crossing.readers.get(found.path)
        if (held !== undefined) return held
        let reader: TypeReader | null = null
        try {
            reader = new TypeReader(tokensOf(found.text), found.path, {
                ...crossing,
                depth: crossing.depth + 1,
            })
        } catch {
            // An unparseable module is one this cannot read a type out of, which is the same answer
            // as a module it could not find. A build must not fail over a shape it was only offering.
            reader = null
        }
        crossing.readers.set(found.path, reader)
        return reader
    }

    /** Every top-level type declaration, so a handler naming one in the same file still derives. */
    private collect(): void {
        const tokens = this.tokens
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i] as Token
            if (token.depth !== 0) continue
            const next = tokens[i + 1]
            if (next === undefined) break
            if (token.text === 'interface' && next.kind === SyntaxKind.Identifier) {
                // The body IS an object type literal, so the same reader handles it.
                const brace = this.find(i + 2, SyntaxKind.OpenBraceToken)
                if (brace >= 0) this.locals.set(next.text, { body: brace, bases: this.bases(i + 2, brace) })
                continue
            }
            if (token.text === 'import') {
                this.importsFrom(i)
                continue
            }
            if (token.text === 'type' && next.kind === SyntaxKind.Identifier) {
                const equals = this.find(i + 2, SyntaxKind.EqualsToken)
                // A generic alias is skipped: its body mentions a parameter this cannot bind.
                const angle = tokens[i + 2]
                if (equals >= 0 && angle?.kind !== SyntaxKind.LessThanToken) {
                    this.locals.set(next.text, { body: equals + 1, bases: [] })
                }
            }
        }
    }

    /**
     * `import type { A, B as C } from './x.ts'`, and the inline `import { type A }` spelling.
     *
     * A default or namespace import is not collected: `import * as NS` reaches types only through a
     * qualified name, which nothing here resolves anyway.
     */
    private importsFrom(at: number): void {
        let i = at + 1
        if (this.tokens[i]?.text === 'type') i++
        if (this.tokens[i]?.kind !== SyntaxKind.OpenBraceToken) return
        const names: [local: string, exported: string][] = []
        i++
        for (; i < this.tokens.length; i++) {
            const token = this.tokens[i] as Token
            if (token.kind === SyntaxKind.CloseBraceToken) break
            if (token.kind === SyntaxKind.CommaToken || token.text === 'type') continue
            if (token.kind !== SyntaxKind.Identifier) continue
            const exported = token.text
            if (this.tokens[i + 1]?.text === 'as' && this.tokens[i + 2]?.kind === SyntaxKind.Identifier) {
                names.push([(this.tokens[i + 2] as Token).text, exported])
                i += 2
                continue
            }
            names.push([exported, exported])
        }
        if (this.tokens[i]?.kind !== SyntaxKind.CloseBraceToken) return
        if (this.tokens[i + 1]?.text !== 'from') return
        const from = this.tokens[i + 2]
        if (from?.kind !== SyntaxKind.StringLiteral) return
        const specifier = from.text.slice(1, -1)
        for (const [local, exported] of names) this.imports.set(local, { from: specifier, exported })
    }

    /**
     * What an `interface` extends, by name, between its name and its body.
     *
     * A GENERIC base is left out rather than half-read: its members mention a parameter this cannot
     * bind, and a base that does not resolve is simply one whose members are missing — which is the
     * direction everything here leans anyway.
     */
    private bases(from: number, brace: number): string[] {
        const found: string[] = []
        let extending = false
        for (let i = from; i < brace; i++) {
            const token = this.tokens[i] as Token
            if (token.text === 'extends') {
                extending = true
                continue
            }
            if (!extending) continue
            if (token.kind === SyntaxKind.CommaToken) continue
            if (token.kind === SyntaxKind.Identifier) {
                // `Base<T>` and `A.B` are both unresolvable, so neither is collected.
                const next = this.tokens[i + 1]
                if (next?.kind === SyntaxKind.LessThanToken || next?.kind === SyntaxKind.DotToken) {
                    i = brace
                    break
                }
                found.push(token.text)
                continue
            }
            break
        }
        return found
    }

    /** The next token of `kind`, without crossing a statement boundary. `-1` when there is none. */
    private find(from: number, kind: SyntaxKind): number {
        const tokens = this.tokens
        for (let i = from; i < tokens.length && i < from + 64; i++) {
            const token = tokens[i] as Token
            if (token.kind === kind) return i
            if (token.kind === SyntaxKind.SemicolonToken) return -1
        }
        return -1
    }

    /** One type expression starting at `at`. Never throws: an unreadable type is `{}`. */
    read(at: number): Read {
        return this.union(at)
    }

    private union(at: number): Read {
        const parts: JsonSchema[] = []
        let optional = false
        let cursor = at
        // A leading `|` is legal and common in a wrapped union.
        if (this.tokens[cursor]?.kind === SyntaxKind.BarToken) cursor++
        for (;;) {
            const part = this.intersection(cursor)
            cursor = part.at
            optional = optional || part.optional
            if (!part.optional || !isAnything(part.schema)) parts.push(part.schema)
            if (this.tokens[cursor]?.kind !== SyntaxKind.BarToken) break
            cursor++
        }
        return { schema: union(parts), optional, at: cursor }
    }

    private intersection(at: number): Read {
        const first = this.postfix(at)
        if (this.tokens[first.at]?.kind !== SyntaxKind.AmpersandToken) return first
        const parts: JsonSchema[] = [first.schema]
        let cursor = first.at
        while (this.tokens[cursor]?.kind === SyntaxKind.AmpersandToken) {
            const next = this.postfix(cursor + 1)
            parts.push(next.schema)
            cursor = next.at
        }
        return { schema: merged(parts), optional: first.optional, at: cursor }
    }

    /** `T[]`, as many times as it is written. */
    private postfix(at: number): Read {
        const read = this.primary(at)
        let schema = read.schema
        let cursor = read.at
        for (;;) {
            if (this.tokens[cursor]?.kind !== SyntaxKind.OpenBracketToken) break
            // `T[K]` is an indexed access, not an array. Only an EMPTY pair is the array suffix.
            if (this.tokens[cursor + 1]?.kind !== SyntaxKind.CloseBracketToken) break
            schema = arrayOf(schema)
            cursor += 2
        }
        return { schema, optional: read.optional, at: cursor }
    }

    private primary(at: number): Read {
        const token = this.tokens[at]
        if (token === undefined) return { schema: ANYTHING, optional: false, at }

        switch (token.kind) {
            case SyntaxKind.OpenBraceToken:
                return this.object(at)
            case SyntaxKind.OpenBracketToken:
                return this.tuple(at)
            case SyntaxKind.OpenParenToken:
                return this.parenthesised(at)
            case SyntaxKind.StringLiteral:
                return {
                    schema: { type: 'string', const: token.text.slice(1, -1) },
                    optional: false,
                    at: at + 1,
                }
            case SyntaxKind.NumericLiteral:
                return { schema: { type: 'number', const: Number(token.text) }, optional: false, at: at + 1 }
        }

        // The type OPERATORS. None of them names a shape this can read, but each has an operand, and
        // consuming it is the whole point: an extent that stopped at `typeof` left the name after it
        // looking like an expression to every pass downstream.
        if (token.text === 'readonly') return this.postfix(at + 1)
        if (TYPE_OPERATORS.has(token.text)) {
            return { schema: ANYTHING, optional: false, at: this.postfix(at + 1).at }
        }

        const keyword = INTRINSICS[token.text]
        if (keyword !== undefined) {
            return { schema: { ...keyword }, optional: NOTHING.has(token.text), at: at + 1 }
        }
        const named = formatOf(token.text)
        if (named !== null) return { schema: named, optional: false, at: at + 1 }
        if (token.kind === SyntaxKind.Identifier || isTypeWord(token)) return this.reference(at)

        // `keyof`, `typeof`, a template literal type, a mapped type — readable by a checker and not
        // by this. Skipping to the end of the type is what keeps the members AFTER it derivable.
        return { schema: ANYTHING, optional: false, at: this.skip(at) }
    }

    /** `Name`, `Name<T, U>`, or `A.B` — resolved when this file declares it, `{}` when it does not. */
    private reference(at: number): Read {
        let cursor = at + 1
        // A qualified name is one type, and no part of it is resolvable from here.
        let qualified = false
        while (this.tokens[cursor]?.kind === SyntaxKind.DotToken) {
            qualified = true
            cursor += 2
        }
        const args: JsonSchema[] = []
        if (this.tokens[cursor]?.kind === SyntaxKind.LessThanToken) {
            cursor = this.arguments(cursor, args)
        }
        if (qualified) return { schema: ANYTHING, optional: false, at: cursor }

        const name = (this.tokens[at] as Token).text
        const first = args[0] ?? ANYTHING

        switch (name) {
            case 'Array':
            case 'ReadonlyArray':
                return { schema: arrayOf(first), optional: false, at: cursor }
            case 'Record':
                // The KEY is a JSON object's name and is always a string there, so only the value
                // shape survives — which is exactly what `additionalProperties` says.
                return {
                    schema: objectOf({}, [], args[1] ?? ANYTHING),
                    optional: false,
                    at: cursor,
                }
            case 'Partial':
                return { schema: loosened(first), optional: false, at: cursor }
            // TRANSPARENT wrappers: what crosses is the argument, so the wrapper contributes nothing
            // to the shape. For the stream types that argument is the CHUNK, which is what an output
            // schema checks — the transcript is not one value, and neither is the shape of it.
            //
            // `Map` and `Set` are deliberately NOT here. Neither survives `JSON.stringify` — both
            // come out `{}` — so a handler taking one over the wire is already broken, and a shape
            // saying "array" or "object" would publish that breakage as a contract and refuse the
            // in-process caller who passed the real thing. Nothing known is the honest answer.
            case 'Promise':
            case 'Awaited':
            case 'PromiseLike':
            case 'AsyncIterable':
            case 'AsyncIterableIterator':
            case 'AsyncGenerator':
            case 'Iterable':
            case 'Generator':
            case 'Readonly':
            case 'NonNullable':
                return { schema: first, optional: false, at: cursor }
        }

        if (args.length > 0) return { schema: ANYTHING, optional: false, at: cursor }
        return { schema: this.local(name), optional: false, at: cursor }
    }

    /** A type this file declares, or one it imports. `{}` for one that is neither. */
    private local(name: string): JsonSchema {
        const declared = this.locals.get(name)
        if (declared === undefined) return this.crossed(name)
        if (this.resolving.has(name)) return ANYTHING
        this.resolving.add(name)
        try {
            const own = this.read(declared.body).schema
            if (declared.bases.length === 0) return own
            // Inherited members are the interface's own members too, so leaving them out would
            // publish a shape that omits half of what the type says. A base that did not resolve
            // contributes nothing rather than erasing what did.
            let built = own
            for (const base of declared.bases) built = inherited(built, this.local(base))
            return built
        } finally {
            this.resolving.delete(name)
        }
    }

    /** A type from another module, when a resolver was supplied and the name came from one. */
    private crossed(name: string): JsonSchema {
        const binding = this.imports.get(name)
        if (binding === undefined || this.crossing === null) return ANYTHING
        const reader = this.readerFor(binding.from)
        if (reader === null) return ANYTHING
        const key = `${reader.path}#${binding.exported}`
        if (this.crossing.active.has(key)) return ANYTHING
        this.crossing.active.add(key)
        try {
            // `private` is class-scoped, so another instance's `local` is reachable from here.
            return reader.local(binding.exported)
        } finally {
            this.crossing.active.delete(key)
        }
    }

    /** A type argument list, from its `<`. Returns the index after the matching `>`. */
    private arguments(at: number, into: JsonSchema[]): number {
        let cursor = at + 1
        for (;;) {
            const token = this.tokens[cursor]
            if (token === undefined) return cursor
            if (closes(token) > 0) return cursor + 1
            const part = this.read(cursor)
            into.push(part.schema)
            if (part.at === cursor) return this.past(at) // read nothing — bail rather than spin
            cursor = part.at
            const next = this.tokens[cursor]
            if (next === undefined) return cursor
            if (next.kind === SyntaxKind.CommaToken) {
                cursor++
                continue
            }
            const closing = closes(next)
            if (closing === 0) return this.past(at)
            // `Array<Array<number>>` scans its close as ONE `>>` token. The extra closes belong to
            // the lists above this one, so they are handed back by stopping ON the token rather than
            // after it — which is why `closes` counts rather than tests.
            return closing === 1 ? cursor + 1 : cursor
        }
    }

    /** `{ a: X; b?: Y; [k: string]: Z }` */
    private object(at: number): Read {
        const properties: Record<string, JsonSchema> = {}
        const required: string[] = []
        let additional: JsonSchema | undefined
        let cursor = at + 1
        const depth = (this.tokens[at] as Token).depth

        for (;;) {
            const token = this.tokens[cursor]
            if (token === undefined) break
            if (token.kind === SyntaxKind.CloseBraceToken) {
                cursor++
                break
            }
            if (
                token.kind === SyntaxKind.SemicolonToken ||
                token.kind === SyntaxKind.CommaToken ||
                token.text === 'readonly'
            ) {
                cursor++
                continue
            }
            // An index signature is the value shape and nothing else — the key of a JSON object is
            // always a string.
            if (token.kind === SyntaxKind.OpenBracketToken) {
                const close = this.find(cursor, SyntaxKind.CloseBracketToken)
                if (close < 0 || this.tokens[close + 1]?.kind !== SyntaxKind.ColonToken) {
                    cursor = this.escape(cursor, depth)
                    continue
                }
                const value = this.read(close + 2)
                additional = value.schema
                cursor = value.at
                continue
            }
            const name = memberName(token)
            if (name === null) {
                cursor = this.escape(cursor, depth)
                continue
            }
            let after = cursor + 1
            let optional = false
            if (this.tokens[after]?.kind === SyntaxKind.QuestionToken) {
                optional = true
                after++
            }
            // A method signature carries no JSON, so it is not a member of the shape.
            if (this.tokens[after]?.kind !== SyntaxKind.ColonToken) {
                cursor = this.escape(after, depth)
                continue
            }
            const value = this.read(after + 1)
            properties[name] = value.schema
            if (!optional && !value.optional) required.push(name)
            cursor = value.at
        }

        return { schema: objectOf(properties, required, additional), optional: false, at: cursor }
    }

    /** A tuple derives to an array of whatever its positions hold — looser than the type, never tighter. */
    private tuple(at: number): Read {
        const parts: JsonSchema[] = []
        let cursor = at + 1
        for (;;) {
            const token = this.tokens[cursor]
            if (token === undefined) break
            if (token.kind === SyntaxKind.CloseBracketToken) {
                cursor++
                break
            }
            if (token.kind === SyntaxKind.CommaToken) {
                cursor++
                continue
            }
            const part = this.read(cursor)
            if (part.at === cursor) {
                cursor++
                continue
            }
            parts.push(part.schema)
            cursor = part.at
        }
        return { schema: arrayOf(union(parts)), optional: false, at: cursor }
    }

    /** `(A | B)`, or the parameter list of a function type — which carries no JSON at all. */
    private parenthesised(at: number): Read {
        const close = this.balanced(at, SyntaxKind.OpenParenToken, SyntaxKind.CloseParenToken)
        if (close < 0) return { schema: ANYTHING, optional: false, at: at + 1 }
        if (this.tokens[close + 1]?.kind === SyntaxKind.EqualsGreaterThanToken) {
            const returns = this.read(close + 2)
            return { schema: ANYTHING, optional: false, at: returns.at }
        }
        const inner = this.read(at + 1)
        return { schema: inner.schema, optional: inner.optional, at: close + 1 }
    }

    /** The index after the token that closes the bracket opened at `at`. `-1` when none does. */
    private balanced(at: number, open: SyntaxKind, close: SyntaxKind): number {
        return balancedFrom(this.tokens, at, open, close)
    }

    private past(at: number): number {
        const close = this.balanced(at, SyntaxKind.LessThanToken, SyntaxKind.GreaterThanToken)
        return close < 0 ? at + 1 : close + 1
    }

    /** Out of a member this cannot read, to the next one — or to the end of the object. */
    private escape(at: number, depth: number): number {
        for (let i = at; i < this.tokens.length; i++) {
            const token = this.tokens[i] as Token
            if (token.depth <= depth && token.kind === SyntaxKind.CloseBraceToken) return i
            if (
                token.depth === depth + 1 &&
                (token.kind === SyntaxKind.SemicolonToken || token.kind === SyntaxKind.CommaToken)
            ) {
                return i + 1
            }
        }
        return this.tokens.length
    }

    /** Past a type nothing here understands, so what follows it is still read in the right place. */
    private skip(at: number): number {
        for (let i = at; i < this.tokens.length; i++) {
            const token = this.tokens[i] as Token
            switch (token.kind) {
                case SyntaxKind.OpenBraceToken:
                    i = this.balanced(i, SyntaxKind.OpenBraceToken, SyntaxKind.CloseBraceToken)
                    if (i < 0) return this.tokens.length
                    break
                case SyntaxKind.OpenParenToken:
                    i = this.balanced(i, SyntaxKind.OpenParenToken, SyntaxKind.CloseParenToken)
                    if (i < 0) return this.tokens.length
                    break
                case SyntaxKind.LessThanToken:
                    i = this.past(i) - 1
                    break
                case SyntaxKind.CommaToken:
                case SyntaxKind.SemicolonToken:
                case SyntaxKind.CloseParenToken:
                case SyntaxKind.CloseBraceToken:
                case SyntaxKind.CloseBracketToken:
                case SyntaxKind.EqualsGreaterThanToken:
                case SyntaxKind.EqualsToken:
                case SyntaxKind.BarToken:
                case SyntaxKind.AmpersandToken:
                    return i
                default:
                    if (closes(token) > 0) return i
            }
        }
        return this.tokens.length
    }

    /** A type argument list, from its `<`. What `GET<Args, T>(…)` says in the one place it can. */
    typeArguments(at: number): { args: JsonSchema[]; at: number } {
        const args: JsonSchema[] = []
        return { args, at: this.arguments(at, args) }
    }

    /**
     * Where the type starting at `at` ENDS, and nothing else.
     *
     * The desugar needs the extent rather than the shape: a type carries no expressions, so a cell
     * name inside one is neither a read nor a binding and every rewrite must leave it alone. Reusing
     * this grammar rather than writing a second one is the whole point — two parsers that could
     * disagree about where a type stops would put the rewrite one token off exactly where the
     * disagreement is.
     */
    extent(at: number): number {
        return this.read(at).at
    }

    /**
     * A type ARGUMENT list at `at`, or `-1` when the `<` was a less-than.
     *
     * TypeScript resolves this ambiguity by speculative parse and so does this: try the list, and
     * accept it only if it closes AND the token after it is one that may follow type arguments in an
     * expression — `(` or a template literal. `a < b, c > (d)` is accepted by that rule, which looks
     * wrong until you notice tsc accepts it too; matching the real disambiguation is the only
     * definition of "exact" available, because the language has no other one.
     */
    tryTypeArguments(at: number): number {
        if (this.tokens[at]?.kind !== SyntaxKind.LessThanToken) return -1
        const args: JsonSchema[] = []
        const after = this.arguments(at, args)
        if (after <= at || after > this.tokens.length) return -1
        const next = this.tokens[after]
        if (next === undefined) return -1
        if (
            next.kind === SyntaxKind.OpenParenToken ||
            next.kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
            next.kind === SyntaxKind.TemplateHead
        ) {
            return after
        }
        return -1
    }
}

// --- putting several together ------------------------------------------------

/** The index of the token closing the bracket opened at `at`, or `-1`. */
function balancedFrom(tokens: Token[], at: number, open: SyntaxKind, close: SyntaxKind): number {
    let depth = 0
    for (let i = at; i < tokens.length; i++) {
        const kind = (tokens[i] as Token).kind
        if (kind === open) depth++
        else if (kind === close && --depth === 0) return i
    }
    return -1
}

// `desugar.ts`'s `OPENERS`/`CLOSERS` minus `TemplateHead`/`TemplateTail`, and deliberately not
// imported from it — that direction cycles (shape -> desugar -> types -> shape). The narrower set is
// what this walk wants: `firstAnnotation` steps over a DECLARATION looking for the `:` that starts a
// type, and a template literal there is a value's, not a nesting this walk has to balance.
const OPENS = new Set<SyntaxKind>([
    SyntaxKind.OpenParenToken,
    SyntaxKind.OpenBracketToken,
    SyntaxKind.OpenBraceToken,
])
const CLOSES = new Set<SyntaxKind>([
    SyntaxKind.CloseParenToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.CloseBraceToken,
])

/** The read and cycle state one resolution shares, built once per `endpointsOf` call. */
export function crossing(resolve: TypeSource): Crossing {
    return { resolve, readers: new Map(), active: new Set(), depth: 0 }
}

/**
 * What one declaration says about itself: whether it streams, and the shapes it names.
 *
 * Over `Shapes` rather than restating its two members, so the shape language has one declaration and
 * a third direction added to it arrives here without an edit.
 */
export interface Declared extends Shapes {
    /**
     * The handler YIELDS, so the value arrives as chunks rather than at once.
     *
     * Read off the tokens for the same reason the export itself is: the browser lane builds a stub
     * that streams from a file it never loads, so the syntax is the whole answer.
     */
    streams: boolean
}

/**
 * What one declaration says about its own shapes, from the two places it can say it.
 *
 * `GET<Args, T>(…)` is the explicit one and wins, because an author who wrote the type arguments
 * wrote them to be read. Otherwise the handler's own annotations answer: the first parameter is the
 * input, the return type is the output — and on a handler that yields, the return type's argument is
 * the CHUNK, which is exactly what an output schema checks.
 */
export function shapesAt(reader: TypeReader, methodAt: number, rpc: boolean): Declared {
    const tokens = reader.tokens
    let input: JsonSchema | undefined
    let output: JsonSchema | undefined
    let at = methodAt + 1

    if (tokens[at]?.kind === SyntaxKind.LessThanToken) {
        const explicit = reader.typeArguments(at)
        at = explicit.at
        // A socket's first type argument is its MESSAGE; its second is the room, which addresses a
        // subscriber rather than travelling in one.
        input = explicit.args[0]
        if (rpc) output = explicit.args[1]
    }

    let streams = false
    if (tokens[at]?.kind === SyntaxKind.OpenParenToken) {
        // ONE walk of the handler's prologue answers both questions asked of it — whether it yields,
        // and where its parameter list starts. Two walks that could disagree would emit a stub that
        // streams from an endpoint whose published shape says it does not.
        const handler = prologue(tokens, at)
        streams = rpc && handler.streams
        if (input === undefined || output === undefined) {
            const annotated = fromHandler(reader, handler.at)
            input ??= annotated.input
            if (rpc) output ??= annotated.output
        }
    }
    // Nothing known is not a shape. An endpoint publishing `{}` would be claiming to describe itself.
    return {
        streams,
        ...(usable(input) ? { input } : {}),
        ...(usable(output) ? { output } : {}),
    }
}

function usable(schema: JsonSchema | undefined): schema is JsonSchema {
    return schema !== undefined && !isAnything(schema)
}

/**
 * Past `async function* name` to the handler's parameter list, and whether it YIELDS.
 *
 * An arrow function cannot be a generator, so the syntax is the whole answer. A handler assembled
 * somewhere else and passed in is not seen as one, which is the documented cost of not running a
 * type-checker here — and it is the same cost that leaves its annotations unread.
 */
function prologue(tokens: Token[], call: number): { at: number; streams: boolean } {
    let at = call + 1
    if (tokens[at]?.text === 'async') at++
    if (tokens[at]?.kind !== SyntaxKind.FunctionKeyword) return { at, streams: false }
    at++
    const streams = tokens[at]?.kind === SyntaxKind.AsteriskToken
    if (streams) at++
    if (tokens[at]?.kind === SyntaxKind.Identifier) at++
    return { at, streams }
}

/** The handler literal's own annotations, from the `(` of its parameter list. */
function fromHandler(reader: TypeReader, params: number): { input?: JsonSchema; output?: JsonSchema } {
    const tokens = reader.tokens
    // Anything but a function LITERAL carries no annotation here to read.
    if (tokens[params]?.kind !== SyntaxKind.OpenParenToken) return {}
    const close = balancedFrom(tokens, params, SyntaxKind.OpenParenToken, SyntaxKind.CloseParenToken)
    if (close < 0) return {}

    const found: { input?: JsonSchema; output?: JsonSchema } = {}
    const colon = firstAnnotation(tokens, params, close)
    if (colon >= 0) {
        const read = reader.read(colon + 1)
        if (usable(read.schema)) found.input = read.schema
    }
    if (tokens[close + 1]?.kind === SyntaxKind.ColonToken) {
        const read = reader.read(close + 2)
        if (usable(read.schema)) found.output = read.schema
    }
    return found
}

/**
 * The `:` that annotates the FIRST parameter.
 *
 * Depth-tracked rather than "the first colon", because `({ id }: { id: number })` is the ordinary
 * spelling and `({ id: named }: …)` puts a colon inside the binding pattern first.
 */
function firstAnnotation(tokens: Token[], params: number, close: number): number {
    let depth = 0
    for (let i = params + 1; i < close; i++) {
        const token = tokens[i] as Token
        if (OPENS.has(token.kind)) depth++
        else if (CLOSES.has(token.kind)) depth--
        else if (depth === 0 && token.kind === SyntaxKind.ColonToken) return i
        else if (depth === 0 && token.kind === SyntaxKind.CommaToken) return -1
    }
    return -1
}

/** How many type-argument lists a token closes: `>` is one, `>>` is two. */
export function closes(token: Token): number {
    const text = token.text
    if (text === '' || text.length > 3) return 0
    for (let i = 0; i < text.length; i++) if (text[i] !== '>') return 0
    return text.length
}

function isTypeWord(token: Token): boolean {
    // `parse.ts`'s grammar, not a second one: one rule for what a name is, so a shape derived here
    // and a name written into the output cannot disagree about it.
    return IDENTIFIER.test(token.text)
}

function memberName(token: Token): string | null {
    if (token.kind === SyntaxKind.StringLiteral) return token.text.slice(1, -1)
    if (token.kind === SyntaxKind.NumericLiteral) return token.text
    return isTypeWord(token) ? token.text : null
}

/** An intersection of object literals is one object. Anything else is more than this can say. */
function merged(parts: JsonSchema[]): JsonSchema {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const part of parts) {
        if (part.type !== 'object' || part.properties === undefined) return ANYTHING
        Object.assign(properties, part.properties)
        if (part.required !== undefined) required.push(...part.required)
    }
    return objectOf(properties, [...new Set(required)], undefined)
}

/**
 * An interface's own members over the ones it inherits. OWN wins, because that is what `extends`
 * means, and a base this could not read is skipped rather than allowed to flatten the result.
 */
function inherited(own: JsonSchema, base: JsonSchema): JsonSchema {
    if (base.type !== 'object' || base.properties === undefined) return own
    const extra = own.additionalProperties ?? base.additionalProperties
    return objectOf(
        { ...base.properties, ...own.properties },
        [...new Set([...(base.required ?? []), ...(own.required ?? [])])],
        typeof extra === 'object' ? extra : undefined,
    )
}

/** `Partial<T>` — the same members, none of them required. */
function loosened(schema: JsonSchema): JsonSchema {
    if (schema.required === undefined) return schema
    const { required: _dropped, ...rest } = schema
    return rest
}
