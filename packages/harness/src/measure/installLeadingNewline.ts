// 43.49 — the HTML parser drops the one newline that follows a `<textarea>`, `<pre>` or `<listing>`
// start tag, so a writer leads such an element's text with a newline wherever that text may itself
// open with one. happy-dom keeps it, and a textarea abide wrote read `"\n"` for its empty value —
// what a form reset to, and what a test read back. This drops it where the spec does: the first text
// the parser hands such an element, before anything else is in it.
//
// happy-dom's parser is no export of the global registrator, so it is resolved beside the copy of
// happy-dom the registrator itself loads, and patched there.

const LEADING_NEWLINE_ELEMENTS = new Set(['TEXTAREA', 'PRE', 'LISTING'])

type Parser = {
    currentNode: { tagName?: string; firstChild: unknown } | undefined
    parsePlainText(text: string): void
}

export async function installLeadingNewline(): Promise<void> {
    const registrator = Bun.resolveSync(
        '@happy-dom/global-registrator',
        import.meta.dir,
    )
    const parserPath = Bun.resolveSync(
        'happy-dom/lib/html-parser/HTMLParser.js',
        registrator.slice(0, registrator.lastIndexOf('/')),
    )
    const { default: HTMLParser } = (await import(parserPath)) as {
        default: { prototype: Parser }
    }
    const prototype = HTMLParser.prototype
    const parsePlainText = prototype.parsePlainText
    if (typeof parsePlainText !== 'function')
        throw new Error(
            "@abide/harness: happy-dom's parser no longer reads text where installLeadingNewline patches it. RULEBOOK 43.49.",
        )
    prototype.parsePlainText = function (this: Parser, text: string): void {
        const node = this.currentNode
        parsePlainText.call(
            this,
            node !== undefined &&
                node.firstChild === null &&
                LEADING_NEWLINE_ELEMENTS.has(node.tagName ?? '')
                ? text.replace(/^\r?\n/, '')
                : text,
        )
    }
}
