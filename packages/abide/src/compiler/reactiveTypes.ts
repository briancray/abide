import type { Node } from 'typescript/unstable/ast'
import {
    isTypeAliasDeclaration,
    isVariableDeclaration,
} from 'typescript/unstable/ast/is'
import {
    type Symbol as CheckedSymbol,
    type Checker,
    ObjectFlags,
    type ObjectType,
    type Project,
    SignatureKind,
    type Type,
    TypeFlags,
    type TypeParameter,
    type TypeReference,
    type UnionOrIntersectionType,
} from 'typescript/unstable/async'
import { aliasedSymbol } from './aliasedSymbol.ts'

// WHAT THE CHECKER SAYS A NAME HOLDS, asked by both of the session's jobs over one snapshot: the
// read classifier (`readsIn`), which asks whether a name is a `Reactive`, and the handler reader
// (`declaredExports`), which asks whether a handler's value nests one (16.39).

/** What calling the `Reactive` a name holds hands back. */
export async function valueTypeOf(
    checker: Checker,
    node: Node,
): Promise<Type | undefined> {
    const type = await checker.getTypeAtLocation(node)
    if (type === undefined) return undefined
    const [call] = await checker.getSignaturesOfType(type, SignatureKind.Call)
    return call === undefined
        ? undefined
        : checker.getReturnTypeOfSignature(call)
}

/**
 * What the value a symbol names was initialized with, through an import to the module that declares
 * it: `reactive(…)` in `const rows = reactive(…)`, wherever `rows` is read from.
 */
export async function boundInitializer(
    checker: Checker,
    symbol: CheckedSymbol,
): Promise<Node | undefined> {
    const bound = await (
        await aliasedSymbol(checker, symbol)
    ).valueDeclaration?.resolve()
    return bound !== undefined && isVariableDeclaration(bound)
        ? bound.initializer
        : undefined
}

/** A union's members, or the type alone where it is not one. */
export async function unionMembers(type: Type): Promise<readonly Type[]> {
    return (type.flags & TypeFlags.Union) !== 0
        ? await (type as UnionOrIntersectionType).getTypes()
        : [type]
}

/**
 * Whether every member of the type passes, `null` and `undefined` aside, and one at least is left
 * to: an optional parameter is its type or `undefined`, and is still the type.
 */
async function everyPresentMember(
    type: Type,
    test: (member: Type) => Promise<boolean>,
): Promise<boolean> {
    let present = false
    for (const member of await unionMembers(type)) {
        if ((member.flags & (TypeFlags.Undefined | TypeFlags.Null)) !== 0)
            continue
        if (!(await test(member))) return false
        present = true
    }
    return present
}

// Where abide declares `Reactive`, `props`, `route` and `Selection`, found in the project the way
// `METHODS_SOURCE` is.
const REACTIVE_SOURCE = Bun.fileURLToPath(
    new URL('../shared/reactive/Reactive.ts', import.meta.url),
)
const PROPS_SOURCE = Bun.fileURLToPath(
    new URL('../shared/props.ts', import.meta.url),
)
const ROUTE_SOURCE = Bun.fileURLToPath(
    new URL('../shared/route.ts', import.meta.url),
)
const SELECTION_SOURCE = Bun.fileURLToPath(
    new URL('../shared/reactive/index.ts', import.meta.url),
)

/**
 * Abide's own `Reactive`, `Selection`, `props` and `route` declarations, as this project's checker
 * names them.
 *
 * 31.3 — A `Reactive` IS TOLD BY ITS DECLARATION, never by how it prints. Every instantiation of
 * abide's `Reactive` carries the symbol of the one type literal it is declared as, whatever alias
 * or re-export the app reached it through — so `type Counter = Reactive<number>` is one, and an
 * app's own type that happens to be spelled `Reactive` is not. `undefined` where the project never
 * reaches abide, and then nothing in it is one. `props` is abide's file as the checker names it.
 */
export type Abide = {
    /** 23.9 — abide's `route`, as the file the checker names it. */
    route: string | undefined
    reactive: CheckedSymbol | undefined
    /**
     * 31.14 — abide's `Selection` alias, which a position may be typed as rather than as a `Reactive`.
     */
    selection: CheckedSymbol | undefined
    props: string | undefined
}

export async function abideIn(project: Project): Promise<Abide> {
    const [declares, props, selects, route] = await Promise.all([
        project.program.getSourceFile(REACTIVE_SOURCE),
        project.program.getSourceFile(PROPS_SOURCE),
        project.program.getSourceFile(SELECTION_SOURCE),
        project.program.getSourceFile(ROUTE_SOURCE),
    ])
    let selection: CheckedSymbol | undefined
    for (const statement of selects?.statements ?? [])
        if (
            isTypeAliasDeclaration(statement) &&
            statement.name.text === 'Selection'
        ) {
            selection = await project.checker.getSymbolAtLocation(
                statement.name,
            )
            break
        }
    let reactive: CheckedSymbol | undefined
    for (const statement of declares?.statements ?? [])
        if (
            isTypeAliasDeclaration(statement) &&
            statement.name.text === 'Reactive'
        ) {
            const literal = await project.checker.getTypeFromTypeNode(
                statement.type,
            )
            reactive = await literal?.getSymbol()
            break
        }
    return { route: route?.path, reactive, selection, props: props?.path }
}

/**
 * Whether a position's type is abide's `Reactive`, or a `Selection`.
 *
 * A union is `Reactive`-typed only where EVERY member is, `null` and `undefined` aside: `s.set`
 * takes `Accepted | Promise<Accepted> | Reactive<Accepted>`, and a position that also takes a
 * plain value is one where a read is what was meant. An intersection with a `Reactive` in it is
 * one. `lists` has `Reactive<X>[]` count too, being the shape a list of sources is declared as —
 * a parameter's question, and never a name's: a name holding an array is read as the array.
 */
export async function isReactiveType(
    checker: Checker,
    abide: Abide,
    type: Type,
    lists: boolean,
): Promise<boolean> {
    if (abide.reactive === undefined) return false
    if (await isSelection(checker, abide, type)) return true
    const reactive = abide.reactive
    return everyPresentMember(type, (member) =>
        isReactiveMember(checker, reactive, member, lists),
    )
}

/**
 * Whether a type is abide's `Selection`, or a type parameter constrained by one.
 *
 * 31.14 — A POSITION TYPED AS A `Selection`, or as a type parameter constrained by one (the free
 * `refresh`, `invalidate`, `busy` and `ready` take `Chosen extends Selection`). A value is never a
 * selection of itself, so a read there hands `refresh` the invoice rather than the thing to reload.
 */
async function isSelection(
    checker: Checker,
    abide: Abide,
    type: Type,
): Promise<boolean> {
    const selection = abide.selection
    if (selection === undefined) return false
    return everyPresentMember(type, async (member) => {
        const declared =
            (member.flags & TypeFlags.TypeParameter) !== 0
                ? await checker.getConstraintOfTypeParameter(
                      member as TypeParameter,
                  )
                : member
        return (await declared?.getAliasSymbol())?.id === selection.id
    })
}

/**
 * Whether one union member is abide's `Reactive`, an intersection with one, or a list of them.
 *
 * `getSymbol` is answered from the client's cache once a symbol has been seen, so past the first
 * `Reactive` in a snapshot this is no round-trip at all.
 */
export async function isReactiveMember(
    checker: Checker,
    reactive: CheckedSymbol,
    type: Type,
    lists: boolean,
): Promise<boolean> {
    if ((await type.getSymbol())?.id === reactive.id) return true
    if ((type.flags & TypeFlags.Intersection) !== 0) {
        for (const part of await (type as UnionOrIntersectionType).getTypes())
            if ((await part.getSymbol())?.id === reactive.id) return true
        return false
    }
    if (
        !lists ||
        ((type as ObjectType).objectFlags & ObjectFlags.Reference) === 0 ||
        !(await checker.isArrayType(type))
    )
        return false
    const [element] = await checker.getTypeArguments(type as TypeReference)
    return (await element?.getSymbol())?.id === reactive.id
}
