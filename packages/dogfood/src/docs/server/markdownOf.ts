// A DOCS PAGE AS MARKDOWN, read off the page the app rendered: the `.md` twin a reader downloads and
// `abide.md` strings together. Derived from the HTML rather than written twice, so the words have one
// home — the page — and the twin cannot say something the page does not.
//
// A READER FOR THE MARKUP `Doc` AND ITS PARTS WRITE, not for HTML at large: headings, prose, lists,
// tables, code under a caption, and an example card, whose running component is left out and whose
// files are written as captioned fences.

const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    nbsp: ' ',
    larr: '←',
    rarr: '→',
}

function decoded(text: string): string {
    return text.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (whole, name: string) => {
        if (name in ENTITIES) return ENTITIES[name] as string
        if (name.startsWith('#x'))
            return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
        if (name.startsWith('#'))
            return String.fromCodePoint(Number(name.slice(1)))
        return whole
    })
}

type Element = {
    tag: string
    attributes: Record<string, string>
    children: Node[]
}
type Node = Element | string

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])
const TOKEN =
    /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*\/?>|[^<]+/g
const ATTRIBUTE = /([^\s=>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g

/** The markup as a tree. Comments — the anchors hydration walks — are dropped. */
function parse(html: string): Element {
    const root: Element = { tag: '', attributes: {}, children: [] }
    const open: Element[] = [root]
    for (const match of html.matchAll(TOKEN)) {
        const [whole, closing, opening, attributes] = match
        const parent = open[open.length - 1] as Element
        if (whole.startsWith('<!--')) continue
        if (closing !== undefined) {
            for (let at = open.length - 1; at > 0; at -= 1)
                if ((open[at] as Element).tag === closing.toLowerCase()) {
                    open.length = at
                    break
                }
            continue
        }
        if (opening === undefined) {
            parent.children.push(decoded(whole))
            continue
        }
        const element: Element = {
            tag: opening.toLowerCase(),
            attributes: {},
            children: [],
        }
        for (const [, name, double, single, bare] of (
            attributes ?? ''
        ).matchAll(ATTRIBUTE))
            element.attributes[name as string] = decoded(
                double ?? single ?? bare ?? '',
            )
        parent.children.push(element)
        if (!VOID.has(element.tag) && !whole.endsWith('/>')) open.push(element)
    }
    return root
}

function classes(element: Element): string[] {
    return (element.attributes.class ?? '').split(/\s+/)
}

function find(
    element: Element,
    matches: (node: Element) => boolean,
): Element | undefined {
    for (const child of element.children) {
        if (typeof child === 'string') continue
        if (matches(child)) return child
        const found = find(child, matches)
        if (found !== undefined) return found
    }
    return undefined
}

function textOf(node: Node): string {
    if (typeof node === 'string') return node
    let text = ''
    for (const child of node.children) text += textOf(child)
    return text
}

/** A link to a page, as a link to its markdown twin — so the download reads without the site. */
function twinOf(href: string): string {
    if (!href.startsWith('/') || /\.\w+(#|$)/.test(href)) return href
    const [path, hash] = href.split('#')
    const twin =
        path === '/' || path === ''
            ? '/index.md'
            : `${path?.replace(/\/$/, '')}.md`
    return hash === undefined ? twin : `${twin}#${hash}`
}

/** Inline markup as markdown, its whitespace collapsed as the browser collapses it. */
function inline(node: Node): string {
    if (typeof node === 'string') return node.replace(/\s+/g, ' ')
    const inner = (): string => {
        let text = ''
        for (const child of node.children) text += inline(child)
        return text
    }
    switch (node.tag) {
        case 'code':
            return `\`${textOf(node)}\``
        case 'strong':
        case 'b':
            return `**${inner()}**`
        case 'em':
            return `*${inner()}*`
        case 'a':
            return `[${inner()}](${twinOf(node.attributes.href ?? '')})`
        case 'br':
            return '\n'
        default:
            return inner()
    }
}

// A fence's language is the code's own class where it has one, and its file's extension where not.
function fence(caption: string, code: string, language = ''): string {
    const spoken =
        language || (/\.(\w+)(?: — excerpt)?$/.exec(caption)?.[1] ?? '')
    return `\`\`\`${spoken}${caption ? ` ${caption}` : ''}\n${code.replace(/\n$/, '')}\n\`\`\``
}

function languageOf(pre: Element | undefined): string {
    const code = pre && find(pre, (node) => node.tag === 'code')
    return /\blanguage-(\w+)/.exec(code?.attributes.class ?? '')?.[1] ?? ''
}

/** Block markup as markdown blocks. */
function blocks(element: Element, out: string[]): void {
    for (const child of element.children) {
        if (typeof child === 'string') {
            if (child.trim() !== '') out.push(child.trim())
            continue
        }
        const kind = classes(child)
        switch (child.tag) {
            case 'h1':
            case 'h2':
            case 'h3':
                out.push(
                    `${'#'.repeat(Number(child.tag[1]))} ${inline(child).trim()}`,
                )
                break
            case 'p':
                out.push(inline(child).trim())
                break
            case 'ul':
            case 'ol': {
                let list = ''
                let index = 1
                for (const item of child.children) {
                    if (typeof item === 'string') continue
                    list += `${child.tag === 'ul' ? '-' : `${index}.`} ${inline(item).trim()}\n`
                    index += 1
                }
                out.push(list.trimEnd())
                break
            }
            case 'table': {
                const rows: string[][] = []
                const walk = (node: Element): void => {
                    for (const part of node.children) {
                        if (typeof part === 'string') continue
                        if (part.tag === 'tr') {
                            const cells: string[] = []
                            for (const cell of part.children)
                                if (typeof cell !== 'string')
                                    cells.push(
                                        inline(cell)
                                            .trim()
                                            .replaceAll('|', '\\|'),
                                    )
                            rows.push(cells)
                        } else walk(part)
                    }
                }
                walk(child)
                const [head, ...body] = rows
                if (head === undefined) break
                let table = `| ${head.join(' | ')} |\n|${' --- |'.repeat(head.length)}`
                for (const row of body) table += `\n| ${row.join(' | ')} |`
                out.push(table)
                break
            }
            case 'blockquote':
                out.push(`> ${inline(child).trim()}`)
                break
            case 'aside':
                out.push(`> [!TIP]\n> ${inline(child).trim()}`)
                break
            case 'pre':
                out.push(fence('', textOf(child), languageOf(child)))
                break
            case 'figure':
                if (kind.includes('example')) out.push(card(child))
                else {
                    // The caption as written — a path or a side word — rather than as shown.
                    const caption = child.attributes['data-caption'] ?? ''
                    const code = find(child, (node) => node.tag === 'pre')
                    out.push(
                        fence(
                            caption,
                            code === undefined ? '' : textOf(code),
                            languageOf(code),
                        ),
                    )
                }
                break
            case 'header':
            case 'footer':
                break
            default:
                blocks(child, out)
        }
    }
}

/** An example card: its title and summary, then each of its files as a captioned fence. */
function card(figure: Element): string {
    const title = find(figure, (node) => classes(node).includes('ex-title'))
    const summary = find(figure, (node) => classes(node).includes('ex-summary'))
    const tabs = find(figure, (node) => classes(node).includes('ex-files'))
    const paths: string[] = []
    for (const tab of tabs?.children ?? [])
        if (typeof tab !== 'string') paths.push(textOf(tab).trim())
    let text = `**${title === undefined ? '' : inline(title).trim()}** — ${summary === undefined ? '' : textOf(summary).trim()}`
    let index = 0
    for (const node of figure.children) {
        if (typeof node === 'string' || node.tag !== 'pre') continue
        text += `\n\n${fence(paths[index] ?? '', textOf(node))}`
        index += 1
    }
    return text
}

/** The page at `html` as markdown: its title, intent, and everything its `main` holds. */
export function markdownOf(html: string): string {
    const tree = parse(html)
    const main = find(tree, (node) => node.attributes.id === 'content')
    if (main === undefined) return ''
    const header = find(main, (node) => node.tag === 'header')
    const out: string[] = []
    const title = header && find(header, (node) => node.tag === 'h1')
    const intent =
        header && find(header, (node) => classes(node).includes('intent'))
    if (title !== undefined) out.push(`# ${inline(title).trim()}`)
    if (intent !== undefined) out.push(`*${inline(intent).trim()}*`)
    blocks(main, out)
    return `${out.join('\n\n')}\n`
}
