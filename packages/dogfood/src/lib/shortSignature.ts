// A SIGNATURE'S SHORT FORM, derived from REGISTRY's full one so the two cannot drift (40.32): a call
// by its parameters' names, an object by its keys, a generic by its name and what it is given — in
// short form too, or `…` where even that runs long. The full form is the page's Types.

const OPENERS = '(<[{'
const CLOSERS = ')>]}'
/** The longest a generic stays spelled out, its arguments already short; past it, `Name<…>`. */
const GENERIC_LENGTH = 40

/**
 * Every backticked span of a REGISTRY cell, in its short form; the prose around them as written.
 * `typed` is the index of a parameter of the signature's call that keeps its type, in short form: the
 * one telling an overload from the others of its name, which by names alone all read the same.
 */
export function shortSignature(cell: string, typed?: number): string {
    return cell.replace(
        /`([^`]+)`/g,
        (_, code: string) => `\`${shortType(code, typed)}\``,
    )
}

/** The parameters of the call a signature is, each as declared, or `undefined` for one that is not a call. */
function parametersIn(code: string): string[] | undefined {
    let callable = code.trim()
    if (callable.startsWith('<'))
        callable = callable.slice(closing(callable, 0) + 1).trim()
    if (!callable.startsWith('(')) return undefined
    const end = closing(callable, 0)
    if (
        !callable
            .slice(end + 1)
            .trim()
            .startsWith('=>')
    )
        return undefined
    return splitTop(callable.slice(1, end), ',')
}

/** A declared parameter's type, in short form, or `''` where it declares none. */
function typeOf(declared: string): string {
    const colon = topLevel(declared, ':')[0]
    return colon === undefined ? '' : shortType(declared.slice(colon + 1))
}

/**
 * Of the signatures of one name's overloads, the index of the first parameter whose short type is not
 * the same in all of them — what tells them apart — or `undefined` where there is one, or none differs.
 */
export function discriminating(
    signatures: readonly string[],
): number | undefined {
    if (signatures.length < 2) return undefined
    const lists: string[][] = []
    for (const signature of signatures) {
        const code = /`([^`]+)`/.exec(signature)?.[1]
        const parameters = code === undefined ? undefined : parametersIn(code)
        if (parameters === undefined) return undefined
        lists.push(parameters)
    }
    let longest = 0
    for (const list of lists) longest = Math.max(longest, list.length)
    for (let index = 0; index < longest; index += 1) {
        const types = new Set<string>()
        for (const list of lists) {
            const declared = list[index]
            types.add(declared === undefined ? '' : typeOf(declared))
        }
        if (types.size > 1) return index
    }
    return undefined
}

function closes(text: string, at: number): boolean {
    const char = text[at] as string
    return CLOSERS.includes(char) && !(char === '>' && text[at - 1] === '=')
}

/** The index of each top-level occurrence of `separator` in `text`, outside brackets and quotes. */
function topLevel(text: string, separator: string): number[] {
    const found: number[] = []
    let depth = 0
    let quote: string | undefined
    for (let at = 0; at < text.length; at += 1) {
        const char = text[at] as string
        if (quote !== undefined) {
            if (char === quote) quote = undefined
            continue
        }
        if (char === "'" || char === '"') quote = char
        else if (OPENERS.includes(char)) depth += 1
        else if (closes(text, at)) depth -= 1
        else if (depth === 0 && text.startsWith(separator, at)) found.push(at)
    }
    return found
}

function splitTop(text: string, separator: string): string[] {
    const parts: string[] = []
    let start = 0
    for (const at of topLevel(text, separator)) {
        parts.push(text.slice(start, at))
        start = at + separator.length
    }
    parts.push(text.slice(start))
    const kept: string[] = []
    for (const part of parts) if (part.trim() !== '') kept.push(part.trim())
    return kept
}

/** The index of the bracket closing the one opening `text` at `from`. */
function closing(text: string, from: number): number {
    let depth = 0
    for (let at = from; at < text.length; at += 1) {
        if (OPENERS.includes(text[at] as string)) depth += 1
        else if (closes(text, at)) {
            depth -= 1
            if (depth === 0) return at
        }
    }
    return -1
}

/** The index of the bracket opening the one that closes `text`. */
function opening(text: string): number {
    let depth = 0
    for (let at = text.length - 1; at >= 0; at -= 1) {
        if (closes(text, at)) depth += 1
        else if (OPENERS.includes(text[at] as string)) {
            depth -= 1
            if (depth === 0) return at
        }
    }
    return -1
}

/** A parameter or a generic's declared name, its type, default and constraint left out. */
function nameOf(declared: string): string {
    const colon = topLevel(declared, ':')[0]
    const named = colon === undefined ? declared : declared.slice(0, colon)
    return named.split(/\s+extends\s+|\s*=\s*/)[0]?.trim() ?? named
}

/** `(a: A, b?: B)` as `(a, b?)`, the parameter at `typed` keeping its short type. */
function parametersOf(list: string, typed?: number): string {
    const names: string[] = []
    const declared = splitTop(list, ',')
    for (let index = 0; index < declared.length; index += 1) {
        const one = declared[index] as string
        const type = index === typed ? typeOf(one) : ''
        names.push(type === '' ? nameOf(one) : `${nameOf(one)}: ${type}`)
    }
    return `(${names.join(', ')})`
}

/** An object member by its key, a method's or a call's by its parameters. */
function memberOf(member: string): string {
    const colon = topLevel(member, ':')[0]
    const head = (colon === undefined ? member : member.slice(0, colon)).trim()
    if (!head.endsWith(')')) return head
    const open = opening(head)
    return `${head.slice(0, open).replace(/<.*>$/, '')}${parametersOf(head.slice(open + 1, -1))}`
}

function joined(parts: string[], separator: string): string {
    return [...new Set(parts)].join(separator)
}

function shortType(source: string, typed?: number): string {
    const text = source.trim()

    const assigned = topLevel(text, '=').find((at) => text[at + 1] !== '>')
    if (assigned !== undefined)
        return `${shortType(text.slice(0, assigned))} = ${shortType(text.slice(assigned + 1))}`

    let callable = text
    if (callable.startsWith('<')) {
        const after = callable.slice(closing(callable, 0) + 1).trim()
        if (after !== '' && !after.startsWith('(')) return shortType(after)
        if (after !== '') callable = after
    }
    if (callable.startsWith('(')) {
        const end = closing(callable, 0)
        const rest = callable.slice(end + 1).trim()
        if (rest.startsWith('=>'))
            return `${parametersOf(callable.slice(1, end), typed)} => ${shortType(rest.slice(2))}`
    }

    const asked = topLevel(text, '?')[0]
    if (asked !== undefined) {
        const branches = text.slice(asked + 1)
        const otherwise = topLevel(branches, ':')[0] ?? branches.length
        return joined(
            [
                shortType(branches.slice(0, otherwise)),
                shortType(branches.slice(otherwise + 1)),
            ],
            ' | ',
        )
    }

    const members = splitTop(text, '|')
    if (members.length > 1) return joined(members.map(shortType), ' | ')
    const parts = splitTop(text, '&')
    if (parts.length > 1) return joined(parts.map(shortType), ' & ')

    if (/^\w+\s+is\s/.test(text)) return 'boolean'
    const prefix = /^(readonly|keyof|typeof|unique|interface|class)\s+/.exec(
        text,
    )
    if (prefix) return `${prefix[1]} ${shortType(text.slice(prefix[0].length))}`

    if (text.endsWith('}')) {
        const open = opening(text)
        const named = text.slice(0, open).trim()
        const keys: string[] = []
        for (const member of splitTop(text.slice(open + 1, -1), ';'))
            for (const one of splitTop(member, ',')) keys.push(memberOf(one))
        const body = keys.length === 0 ? '{}' : `{ ${joined(keys, ', ')} }`
        return named === '' ? body : `${named} ${body}`
    }
    if (text.endsWith(']') && !text.startsWith('[')) {
        const open = opening(text)
        return `${shortType(text.slice(0, open))}[${text.slice(open + 1, -1).trim()}]`
    }
    if (text.startsWith('(') && closing(text, 0) === text.length - 1)
        return `(${shortType(text.slice(1, -1))})`
    if (text.startsWith('[') && closing(text, 0) === text.length - 1)
        return `[${splitTop(text.slice(1, -1), ',').map(shortType).join(', ')}]`

    const generic = text.indexOf('<')
    if (generic > 0 && closing(text, generic) === text.length - 1) {
        const name = text.slice(0, generic)
        const given = splitTop(text.slice(generic + 1, -1), ',')
        const declared = given.some(
            (one) => topLevel(one, '=').length > 0 || /\sextends\s/.test(one),
        )
        const names = given.map((one) =>
            declared ? nameOf(one) : shortType(one),
        )
        const spelled = `${name}<${names.join(', ')}>`
        return declared || spelled.length <= GENERIC_LENGTH
            ? spelled
            : `${name}<…>`
    }
    return text
}

/** A full signature an app reads by calling: a function, an object of calls, or a callable value. */
const CALLED =
    /^`(?:\(|<[^`]*?>\s*\(|\{\s*\(|(?:Reactive|Rpc|Keyed|Middleware)\b)/

/**
 * Whether a row directly under a REGISTRY section is in the page's Syntax (40.32): the name the page
 * documents, or a name that is not a type and is called. Every other row is in the page's Types alone.
 */
export function inSyntax(
    name: string,
    signature: string,
    section: string,
): boolean {
    const names = [...name.matchAll(/`([^`]+)`/g)].map((match) => match[1])
    const documented = [...section.matchAll(/`([^`]+)`/g)].map(
        (match) => match[1],
    )
    if (names.length > 0 && names.every((one) => documented.includes(one)))
        return true
    const last = names[0]?.split('.').at(-1) ?? ''
    return !/^[A-Z][a-z]/.test(last) && CALLED.test(signature)
}
