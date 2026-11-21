// A SIGNATURE'S SHORT FORM (40.32): what a page's Syntax shows of a REGISTRY signature, its full form
// being the page's Types.

import { expect, test } from 'bun:test'

import {
    inSyntax,
    membersOf,
    parametersNamed,
    shortSignature,
} from './shortSignature.ts'

const CASES: [string, string][] = [
    // A call: parameters by name, generics dropped, a long return by its name.
    [
        '`<Accepted, Shaped = Accepted>(initial: Accepted | Promise<Accepted>, options?: ReactiveOptions<Accepted, Kept<Shaped>, never>) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped> | Gated<Gate, Accepted>>`',
        '`(initial, options?) => Reactive<…>`',
    ],
    // An arrow's return runs to the end, a union included.
    ['`() => void | Disposer`', '`() => void | Disposer`'],
    // A short generic stays spelled out.
    [
        '`(args: Args, init?: RequestInit) => Promise<Response>`',
        '`(args, init?) => Promise<Response>`',
    ],
    // A declared generic keeps its parameters' names, their defaults and constraints left out.
    [
        '`Reactive<Stored = undefined, Accepted = Stored, Failures = never, Produced = Stored>`',
        '`Reactive<Stored, Accepted, Failures, Produced>`',
    ],
    // An object by its keys, a method by its parameters; a type predicate is a boolean.
    ['`{ ui?: boolean; mcp?: boolean }`', '`{ ui?, mcp? }`'],
    [
        '`{ list(): ToolDefinition[]; call(name: string, input: unknown): Promise<ToolAnswer> }`',
        '`{ list(), call(name, input) }`',
    ],
    [
        '`<Name extends string>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>`',
        '`(error, name) => boolean`',
    ],
    // A conditional type is the union of its branches.
    [
        '`() => [A] extends [true] ? Reactive<StoredOf<Accepted>, StoredOf<Accepted>> : Reactive<Kept<Accepted>, Accepted, Refused<Accepted>>`',
        '`() => Reactive<…>`',
    ],
    // Prose around the code stays as written.
    [
        "same as `GET`, with `RpcOptions` in place of `Omit<RpcOptions, 'refreshes'>`",
        "same as `GET`, with `RpcOptions` in place of `Omit<RpcOptions, 'refreshes'>`",
    ],
    ['`<length>`', '`<length>`'],
]

// THE REVERT: return `cell` from `shortSignature` unchanged, and every case whose short form differs
// from its full one fails.
test('a signature is shown by its names, its full form left to Types — 40.32', () => {
    const wrong: string[] = []
    for (const [full, short] of CASES) {
        const shown = shortSignature(full)
        if (shown !== short)
            wrong.push(`${full}\n  -> ${shown}\n  want ${short}`)
    }
    expect(wrong).toEqual([])
})

// THE REVERT: return `true` from `inSyntax`, and the two types are named.
test('the syntax is the documented name and what is called, a type left to Types — 40.32', () => {
    const rows: [string, string, string, boolean][] = [
        [
            '`reactive`',
            '`<T>(body: () => T) => Reactive<T>`',
            '`reactive`',
            true,
        ],
        ['`Accepted`', '`unknown`', '`reactive`', false],
        ['`Transformer`', '`(value: Accepted) => Stored`', '`reactive`', false],
        ['`online`', '`Reactive<boolean>`', '`online`', true],
        ['`rpc.busy`', '`(pattern?: Partial<Args>) => boolean`', '`GET`', true],
        ['`rpc.method`', '`string`', '`GET`', false],
        ['`StagedUpdate.install`', '`() => void`', '`pendingUpdate`', true],
        ['`Chart`', "`{ label: string } & Attributes<'div'>`", '`Chart`', true],
    ]
    const wrong: string[] = []
    for (const [name, signature, section, shown] of rows)
        if (inSyntax(name, signature, section) !== shown) wrong.push(name)
    expect(wrong).toEqual([])
})

// THE REVERT: return `undefined` from `membersOf`, and every object is named; return `[]` from
// `parametersNamed`, and every call is.
test('a parameter typed by a name is read by its name, and an object type by its members — 40.33', () => {
    expect(
        parametersNamed(
            '`<Item>(options: ComboboxOptions<Item>, extra?: readonly Extra, rest: { a: A }) => Parts`',
        ),
    ).toEqual([
        { parameter: 'options', type: 'ComboboxOptions' },
        { parameter: 'extra?', type: 'Extra' },
    ])
    expect(parametersNamed('`{ ui?: boolean }`')).toEqual([])
    expect(
        membersOf(
            '`<Node>{ roots: readonly Node[] | (() => readonly Node[]); children?(node: Node): Node[]; onpick?: (node: Node) => void }`',
        ),
    ).toEqual([
        { name: 'roots', type: 'readonly Node[] | (() => readonly Node[])' },
        { name: 'children?', type: '(node: Node) => Node[]' },
        { name: 'onpick?', type: '(node: Node) => void' },
    ])
    expect(membersOf('`ListboxOptions<Option> = { id: string }`')).toEqual([
        { name: 'id', type: 'string' },
    ])
    expect(membersOf("`{ label: string } & Attributes<'div'>`")).toBeUndefined()
    expect(membersOf('`(options: Options) => Parts`')).toBeUndefined()
})
