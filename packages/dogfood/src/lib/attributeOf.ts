/**
 * An attribute's text in a tag's source, or `undefined` where the tag does not write it: `name="…"`
 * as written, or a string expression — `{'…'}`, `{"…"}` or `` {`…`} ``, which a value holding a
 * quote or a brace needs — with its escapes read.
 *
 * What the assistant's card list and the docs tests both read a page's `<Example>` and `<Code>` by,
 * so the two cannot disagree on a spelling.
 */
export function attributeOf(tag: string, name: string): string | undefined {
    const found = new RegExp(
        `\\b${name}=(?:"([^"]*)"|\\{'((?:\\\\.|[^'\\\\])*)'\\}|\\{"((?:\\\\.|[^"\\\\])*)"\\}|\\{\`((?:\\\\.|[^\`\\\\])*)\`\\})`,
    ).exec(tag)
    if (found === null) return undefined
    if (found[1] !== undefined) return found[1]
    return (found[2] ?? found[3] ?? found[4] ?? '').replace(/\\(.)/g, '$1')
}
