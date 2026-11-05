import {
    getTouchingPropertyName,
    type Node,
    NodeFlags,
    SyntaxKind,
} from 'typescript/unstable/ast'
import {
    type Checker,
    type CompletionEntry,
    type CompletionInfo,
    CompletionItemKind,
    NodeBuilderFlags,
    type Project,
    SignatureKind,
    type Symbol as CheckedSymbol,
    SymbolFlags,
    type Type,
} from 'typescript/unstable/async'

import { aliasedSymbol } from './aliasedSymbol.ts'
import { COMPONENT_STAND_IN } from './checkedShadow.ts'
import { lineOf } from './lineOf.ts'
import { CHECKED_VALUES } from './Lowering.ts'
import type { Span } from './projectShadow.ts'
import type { ShadowHost } from './ShadowHost.ts'
import { CHECKED_SUFFIX, ShadowMap } from './ShadowMap.ts'
import { templateContext } from './templateContext.ts'

/**
 * One `.abide` as a diagnosis lowered it into the checker: the text it lowered and the map from that
 * text to what the checker reads — what an editor's questions about the file are asked through.
 *
 * 38.39 — `text` IS WHAT THE LOWERING WAS MADE OF, and an offset the editor asks at maps through a
 * lowering of the same text or not at all: a file the parser refuses keeps its last lowering, whose
 * offsets have moved under every edit since. Every question is asked of the host's last snapshot,
 * which holds this lowering, and a span in another `.abide` maps back through that file's own.
 */
export class LoweredFile {
    readonly text: string
    readonly map: ShadowMap
    private readonly host: ShadowHost

    constructor(host: ShadowHost, text: string, map: ShadowMap) {
        this.host = host
        this.text = text
        this.map = map
    }

    /**
     * Where the author's `offset` in `text` stands in what the checker reads, or `undefined` where
     * `text` is not what was lowered.
     */
    private askedAt(
        text: string,
        offset: number,
    ): { path: string; position: number } | undefined {
        if (this.text !== text) return undefined
        const asked = this.map.fromSource(offset)
        return asked === undefined || !this.host.holds(asked.path)
            ? undefined
            : asked
    }

    /**
     * The members that may be written at `offset` in a script or an expression, or `undefined`
     * where none can be (`completionAt`).
     */
    async complete(
        text: string,
        offset: number,
        triggerCharacter?: string,
    ): Promise<CompletionInfo | undefined> {
        const asked = this.askedAt(text, offset)
        if (asked === undefined) return undefined
        return this.host.ask(
            (project) =>
                project.checker.getCompletionsAtPosition(
                    asked.path,
                    asked.position,
                    { triggerCharacter },
                ),
            { latest: true },
        )
    }

    /**
     * The props of the component `tag` names that `written` does not, as completions.
     *
     * A PROP IS ASKED OF THIS LOWERING, by the component's name: the tag being typed is text the
     * parser refuses, and the import the name resolves through is the same in the lowering before it.
     */
    async propsUnwritten(
        tag: string,
        written: readonly string[],
    ): Promise<CompletionEntry[]> {
        const entries = await this.host.ask(
            async (project) => {
                const checker = project.checker
                const found = await checker.resolveName(
                    tag,
                    SymbolFlags.Value,
                    { document: this.map.shadowPath, position: 0 },
                )
                const record =
                    found === undefined
                        ? undefined
                        : await propsRecordOf(
                              checker,
                              await aliasedSymbol(checker, found),
                          )
                if (record === undefined) return []
                const unwritten = (
                    await checker.getPropertiesOfType(record)
                ).filter((prop) => !written.includes(prop.name))
                return Promise.all(
                    unwritten.map(async (prop) => {
                        const type = await checker.getTypeOfSymbol(prop)
                        return {
                            name: prop.name,
                            kind: CompletionItemKind.Property,
                            detail:
                                type === undefined
                                    ? undefined
                                    : await checker.typeToString(
                                          type,
                                          undefined,
                                          NodeBuilderFlags.NoTruncation,
                                      ),
                        }
                    }),
                )
            },
            { latest: true },
        )
        return entries ?? []
    }

    /**
     * The hover signature, documentation and definitions of the name at `offset`.
     *
     * 38.39 — WHAT THE NAME AT `offset` IS, asked of the program this lowering is in: its type and
     * documentation for a hover, and where it is declared for a jump. The checked module is asked
     * where the position was copied into it, which is what a member hangs off — `regions.join` is
     * `Array`'s — and the projection where the lowering rewrote it, so a name read by name is the
     * `Reactive` it was declared as.
     */
    async inspect(
        text: string,
        offset: number,
    ): Promise<Inspection | undefined> {
        const asked = this.askedAt(text, offset)
        if (asked === undefined) return undefined
        const inspection = await this.host.ask(
            async (project) => {
                const checker = project.checker
                const found = await checker.getSymbolAtPosition(
                    asked.path,
                    asked.position,
                )
                if (found === undefined) return undefined
                const symbol = await aliasedSymbol(checker, found)
                const declarations: Node[] = []
                for (const handle of symbol.declarations) {
                    const node = await handle.resolve(project)
                    if (node !== undefined) declarations.push(node)
                }
                // A `.abide` import resolves to its checked module's stand-in, which is the
                // component.
                const component =
                    symbol.name === COMPONENT_STAND_IN &&
                    declarations[0]
                        ?.getSourceFile()
                        .fileName.endsWith(CHECKED_SUFFIX)
                const [signature, documentation] = component
                    ? [
                          `(component) ${found.name}(props: ${await propsTypeOf(checker, symbol)})`,
                          '',
                      ]
                    : await Promise.all([
                          describe(project, symbol, declarations[0]),
                          symbol.getDocumentationComment(checker),
                      ])
                const definitions: Place[] = []
                for (const node of declarations) {
                    const named = (node as { name?: Node }).name ?? node
                    const file = node.getSourceFile()
                    definitions.push(
                        this.spanInSource(
                            file.fileName,
                            file.text,
                            named.getStart(file),
                            named.end,
                        ),
                    )
                }
                return {
                    signature: signature.replaceAll(`${CHECKED_VALUES}.`, ''),
                    documentation,
                    definitions,
                }
            },
            { latest: true },
        )
        return inspection
    }

    /**
     * Every place the name at `offset` is written, across the files the checker holds, or
     * `undefined` where nothing is named there.
     *
     * 38.116 — ASKED OF EVERY PLACE THE CHECKER READS THE OFFSET AT (`ShadowMap.placesFrom`), because
     * the checked module rewrites a name read by name into another symbol's read: the projection is
     * where a reactive's markup uses are the declaration's references. A place is kept only where
     * both layers copied it from the author's text and that text is the name, so scaffolding a
     * lowering wrote is never a place to rename.
     *
     * AND ASKED AGAIN WHERE A REFERENCE IS TEXT THE CHECKED MODULE COPIES TWICE. A component's props
     * type is a second copy of its `props` call (`checkedShadow`), and a tag's keys are typed by
     * that copy: the checker answers them as another symbol's references, so a reference landing
     * on one copy is asked at every place the author's text is read.
     */
    async references(
        text: string,
        offset: number,
    ): Promise<References | undefined> {
        if (this.text !== text) return undefined
        const asked = this.map.placesFrom(offset)
        if (asked.length === 0) return undefined
        return this.host.ask((project) => this.referencesIn(project, asked), {
            latest: true,
        })
    }

    private async referencesIn(
        project: Project,
        asked: { path: string; position: number }[],
    ): Promise<References | undefined> {
        const askedAt = new Set<string>()
        for (const place of asked)
            askedAt.add(`${place.path}:${place.position}`)
        let name: Place | undefined
        let spelled = ''
        let renamable = true
        const seen = new Set<string>()
        const occurrences: Occurrence[] = []
        for (let index = 0; index < asked.length; index += 1) {
            const { path: file, position } = asked[index] as {
                path: string
                position: number
            }
            const sourceFile = await project.program.getSourceFile(file)
            if (sourceFile === undefined) continue
            const node = getTouchingPropertyName(sourceFile, position)
            if (node.kind !== SyntaxKind.Identifier) continue
            const written = node.getText(sourceFile)
            if (name === undefined) {
                const copied = this.copiedSpan(node, written)
                name = copied === undefined ? undefined : placeOfSpan(copied)
                spelled = written
            }
            const entries = await project.checker.getReferencedSymbolsForNode(
                node,
                position,
            )
            for (const entry of entries) {
                const definition = await entry.definition.resolve(project)
                if (definition === undefined) continue
                const declaredIn = definition.getSourceFile().fileName
                if (!this.authored(declaredIn)) renamable = false
                const declared = (definition as { name?: Node }).name
                const references = await Promise.all(
                    entry.references.map((handle) => handle.resolve(project)),
                )
                for (const reference of references) {
                    if (reference === undefined) continue
                    const copied = this.copiedSpan(reference, written)
                    if (copied === undefined) continue
                    const declaration =
                        declared !== undefined &&
                        declared.pos === reference.pos &&
                        declaredIn === reference.getSourceFile().fileName
                    // Text the checker reads at more than one place is asked at every one.
                    const copies = copied.map?.placesFrom(copied.start) ?? []
                    if (copies.length > 2)
                        for (const place of copies) {
                            const at = `${place.path}:${place.position}`
                            if (askedAt.has(at)) continue
                            askedAt.add(at)
                            asked.push(place)
                        }
                    const placed = placeOfSpan(copied)
                    const key = `${placed.path}:${placed.start.line}:${placed.start.column}`
                    if (seen.has(key)) continue
                    seen.add(key)
                    const holder = reference.parent
                    const declaresHolder =
                        definition.pos === holder.pos &&
                        declaredIn === reference.getSourceFile().fileName
                    const shorthand =
                        holder.kind ===
                            SyntaxKind.ShorthandPropertyAssignment ||
                        (holder.kind === SyntaxKind.BindingElement &&
                            (holder as { propertyName?: Node }).propertyName ===
                                undefined)
                    occurrences.push({
                        ...placed,
                        declaration,
                        // A shorthand names a property and a binding at once, and renaming one
                        // writes the other out beside it: the binding element declares the local
                        // and the shorthand assignment the property.
                        shorthand: !shorthand
                            ? undefined
                            : declaresHolder ===
                                (holder.kind === SyntaxKind.BindingElement)
                              ? 'local'
                              : 'property',
                    })
                }
            }
        }
        if (name === undefined) return undefined
        return { name, written: spelled, renamable, occurrences }
    }

    /**
     * Whether a file the checker read is one an author wrote and can edit: neither a library's
     * declaration, nor a dependency's, nor scaffolding the host serves that stands for no `.abide`.
     */
    private authored(fileName: string): boolean {
        if (fileName.endsWith('.d.ts') || fileName.includes('/node_modules/'))
            return false
        return (
            ShadowMap.fileFor(this.host.canonical(fileName)) !== undefined ||
            !this.host.holds(fileName)
        )
    }

    /**
     * Where a node the checker read stands in the file the author wrote, with that file's map where
     * it is a `.abide`, or `undefined` where the author did not write `name` there: in scaffolding,
     * or in a file the host serves.
     */
    private copiedSpan(node: Node, name: string): CopiedSpan | undefined {
        const file = node.getSourceFile()
        let start = node.getStart(file)
        let end = node.end
        // A string literal names a property by its text, inside the quotes.
        if (node.kind === SyntaxKind.StringLiteral) {
            start += 1
            end -= 1
        }
        const canonical = this.host.canonical(file.fileName)
        const abidePath = ShadowMap.fileFor(canonical)
        if (abidePath === undefined) {
            if (!this.authored(file.fileName)) return undefined
            if (file.text.slice(start, end) !== name) return undefined
            return {
                path: file.fileName,
                text: file.text,
                start,
                end,
                map: undefined,
            }
        }
        const lowered = this.host.lowered(abidePath)
        const span = lowered?.map.copiedToSource(canonical, start, end)
        if (
            lowered === undefined ||
            span === undefined ||
            lowered.text.slice(span.start, span.end) !== name
        )
            return undefined
        return {
            path: abidePath,
            text: lowered.text,
            start: span.start,
            end: span.end,
            map: lowered.map,
        }
    }

    /**
     * A span the checker read, placed in the file the author wrote: a lowered `.abide` mapped back
     * through both of its maps, and one the host has not lowered — or a span of the scaffolding a
     * lowering adds, which the author never wrote — placed at its top.
     */
    private spanInSource(
        fileName: string,
        text: string,
        start: number,
        end: number,
    ): Place {
        const canonical = this.host.canonical(fileName)
        const abidePath = ShadowMap.fileFor(canonical)
        if (abidePath === undefined)
            return {
                path: fileName,
                start: lineOf(text, start),
                end: lineOf(text, end),
            }
        const lowered = this.host.lowered(abidePath)
        const placed = lowered?.map.spanToSource(canonical, start, end)
        if (lowered === undefined || placed === undefined) {
            const top = { line: 1, column: 1 }
            return { path: abidePath, start: top, end: top }
        }
        return {
            path: abidePath,
            start: lineOf(lowered.text, placed.start),
            end: lineOf(lowered.text, placed.end),
        }
    }
}

/**
 * The completions at `offset` in a `.abide`'s `text`, asked through `lowered` — its file's last
 * lowering, where it has one — or `undefined` where none can be written.
 *
 * 38.98 — ASKED WHERE A HOVER IS, so `config().` offers the fields 27.13 declared and a name read by
 * name offers its value's members (31.1). MEMBERS ALONE in a script or an expression: at an
 * identifier the API rejects ("completion list needs auto imports"), which the language server
 * answers as nothing offered. 38.117 — MARKUP offers a block keyword, a component in scope, or a
 * component's props, the last of which is the one a lowering is needed for.
 */
export async function completionAt(
    lowered: LoweredFile | undefined,
    text: string,
    offset: number,
    triggerCharacter?: string,
): Promise<CompletionInfo | undefined> {
    const template = templateContext(text, offset)
    if (template === undefined)
        return lowered?.complete(text, offset, triggerCharacter)
    if (template.kind === 'attribute')
        return {
            isIncomplete: false,
            entries:
                lowered === undefined
                    ? []
                    : await lowered.propsUnwritten(
                          template.tag,
                          template.written,
                      ),
        }
    const kind =
        template.kind === 'block'
            ? CompletionItemKind.Keyword
            : CompletionItemKind.Class
    const entries: CompletionEntry[] = []
    for (const name of template.offered) entries.push({ name, kind })
    return { isIncomplete: false, entries }
}

/**
 * Where something is in a file the author wrote, line and column from 1.
 *
 * 38.39.
 */
export type Place = {
    path: string
    start: { line: number; column: number }
    end: { line: number; column: number }
}

/**
 * The name under a cursor: how it is declared, what its doc comment says, and where.
 *
 * 38.39.
 */
export type Inspection = {
    signature: string
    documentation: string
    definitions: Place[]
}

/**
 * The name under a cursor and every place it is written.
 *
 * 38.116 — `name` is where the cursor's own name stands; `renamable` is false where any symbol it
 * names is declared somewhere an author does not write.
 */
export type References = {
    name: Place
    /** The name as it is written. */
    written: string
    renamable: boolean
    occurrences: Occurrence[]
}

/**
 * One place a name is written: whether it is where the name is declared, and where it is a
 * shorthand, which side of it a rename renames — the `local` binding or the `property`.
 */
type Occurrence = Place & {
    declaration: boolean
    shorthand: 'local' | 'property' | undefined
}

/** A span of a file the author wrote, and the map of the `.abide` it is in, where it is in one. */
type CopiedSpan = Span & {
    path: string
    text: string
    map: ShadowMap | undefined
}

/** A `CopiedSpan` as lines and columns. */
function placeOfSpan(span: CopiedSpan): Place {
    return {
        path: span.path,
        start: lineOf(span.text, span.start),
        end: lineOf(span.text, span.end),
    }
}

/**
 * The props type a component's tag is held to, printed.
 *
 * 33.4 — the record its stand-in is called with.
 */
async function propsTypeOf(
    checker: Checker,
    component: CheckedSymbol,
): Promise<string> {
    const record = await propsRecordOf(checker, component)
    return record === undefined
        ? 'any'
        : checker.typeToString(record, undefined, NodeBuilderFlags.NoTruncation)
}

/** The record a component is called with — the props its tag is held to (33.4). */
async function propsRecordOf(
    checker: Checker,
    component: CheckedSymbol,
): Promise<Type | undefined> {
    const type = await checker.getTypeOfSymbol(component)
    const call =
        type === undefined
            ? undefined
            : (await checker.getSignaturesOfType(type, SignatureKind.Call))[0]
    return call === undefined ? undefined : checker.getParameterType(call, 0)
}

/**
 * How a hover spells a symbol, as tsserver does: the keyword it was declared with, its name, and its
 * type — a function's first signature, with how many more it has.
 */
async function describe(
    project: Project,
    symbol: CheckedSymbol,
    declaration: Node | undefined,
): Promise<string> {
    const checker = project.checker
    const flags = symbol.flags
    const name = symbol.name
    if (flags & SymbolFlags.Interface) return `interface ${name}`
    if (flags & SymbolFlags.Class) return `class ${name}`
    if (flags & SymbolFlags.TypeAlias)
        return `type ${name} = ${await checker.typeToString(
            await checker.getDeclaredTypeOfSymbol(symbol),
            undefined,
            NodeBuilderFlags.NoTruncation,
        )}`
    const type = await checker.getTypeOfSymbol(symbol)
    if (type === undefined) return name
    if (flags & (SymbolFlags.Function | SymbolFlags.Method)) {
        const signatures = await checker.getSignaturesOfType(
            type,
            SignatureKind.Call,
        )
        const first = signatures[0]
        const declared =
            first === undefined
                ? undefined
                : await checker.signatureToSignatureDeclaration(
                      first,
                      SyntaxKind.MethodSignature,
                      undefined,
                      NodeBuilderFlags.NoTruncation,
                  )
        if (declared !== undefined) {
            const printed = (await project.emitter.printNode(declared))
                .trim()
                .replace(/;$/, '')
            const more = signatures.length - 1
            return `${flags & SymbolFlags.Function ? 'function' : '(method)'} ${name}${printed}${
                more > 0 ? ` (+${more} overload${more === 1 ? '' : 's'})` : ''
            }`
        }
    }
    const spelled = await checker.typeToString(
        type,
        undefined,
        NodeBuilderFlags.NoTruncation,
    )
    let keyword = '(property)'
    if (flags & SymbolFlags.Function) keyword = 'function'
    else if (flags & SymbolFlags.Method) keyword = '(method)'
    else if (declaration?.kind === SyntaxKind.Parameter) keyword = '(parameter)'
    else if (flags & SymbolFlags.Variable) {
        const list = declaration?.parent.flags ?? 0
        keyword =
            list & NodeFlags.Const
                ? 'const'
                : list & NodeFlags.Let
                  ? 'let'
                  : 'var'
    }
    return `${keyword} ${name}: ${spelled}`
}
