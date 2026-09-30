import { CHARACTER_REFERENCES } from './CHARACTER_REFERENCES.ts'

// STATIC TEMPLATE TEXT AS THE CHARACTERS IT STANDS FOR, decoded at BUILD time by the HTML spec's
// rules — 32.27's `AT&amp;T` is `AT&T` wherever the build hands text over as data rather than as
// markup: a component's prop, the static pieces of an interpolated attribute, and every static
// string a row the browser BUILDS writes through `data` or `setAttribute`. The rule exactly, edges
// included — a numeric reference with or without its `;`, the windows-1252 remap for 0x80–0x9F,
// U+FFFD for zero, a surrogate or past U+10FFFF, and the longest named reference in the list. The
// two rules differ in one place: in an ATTRIBUTE a named reference with no `;` that is followed by
// `=` or an ASCII letter or digit stays as written (`?a=1&copy=2`), and in TEXT it decodes.
//
// A TABLE, NOT THE PARSER, which would be a parse per string in the browser. A built row has to
// agree with the bytes the browser parsed for the rows the server painted, and the table was
// checked against chromium's reading of 16,510 inputs under each rule — every name in the list
// followed by each character that moves the rule, every number to 0x11F in each spelling, and the
// range edges — with no difference; WHATWG has frozen the list. It stays in the compiler: two
// thousand entries no page needs, and nothing a client bundle reaches may import it.

// The remap for a numeric reference in 0x80–0x9F, indexed from 0x80; 0 is none, and the number
// stands for itself.
const WINDOWS_1252 = [
    0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
    0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d,
    0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e,
    0x0178,
]

// `&CounterClockwiseContourIntegral;` less its `&`.
const LONGEST_NAME = 32

export function decodeCharacterReferences(
    text: string,
    rule: 'attribute' | 'text',
): string {
    let out = ''
    let from = 0
    let at = text.indexOf('&')
    while (at !== -1) {
        const reference =
            text[at + 1] === '#'
                ? numericReference(text, at)
                : namedReference(text, at, rule)
        if (reference === undefined) {
            at = text.indexOf('&', at + 1)
            continue
        }
        out += text.slice(from, at) + reference.text
        from = reference.end
        at = text.indexOf('&', from)
    }
    return from === 0 ? text : out + text.slice(from)
}

function namedReference(
    text: string,
    at: number,
    rule: 'attribute' | 'text',
): { text: string; end: number } | undefined {
    for (
        let end = Math.min(text.length, at + 1 + LONGEST_NAME);
        end > at + 1;
        end -= 1
    ) {
        const name = text.slice(at + 1, end)
        if (!Object.hasOwn(CHARACTER_REFERENCES, name)) continue
        if (
            rule === 'attribute' &&
            !name.endsWith(';') &&
            end < text.length &&
            (text[end] === '=' || isAlphanumeric(text.charCodeAt(end)))
        )
            return undefined
        return { text: CHARACTER_REFERENCES[name] as string, end }
    }
    return undefined
}

function numericReference(
    text: string,
    at: number,
): { text: string; end: number } | undefined {
    const hex = text[at + 2] === 'x' || text[at + 2] === 'X'
    const start = at + (hex ? 3 : 2)
    let end = start
    let code = 0
    for (; end < text.length; end += 1) {
        const digit = digitOf(text.charCodeAt(end), hex)
        if (digit === -1) break
        // Held just past the range rather than grown: a thousand digits are still out of range.
        code = Math.min(code * (hex ? 16 : 10) + digit, 0x110000)
    }
    if (end === start) return undefined
    if (text[end] === ';') end += 1
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        code = 0xfffd
    else if (code >= 0x80 && code <= 0x9f)
        code = (WINDOWS_1252[code - 0x80] as number) || code
    return { text: String.fromCodePoint(code), end }
}

function digitOf(char: number, hex: boolean): number {
    if (char >= 48 && char <= 57) return char - 48
    if (!hex) return -1
    const lower = char | 0x20
    return lower >= 97 && lower <= 102 ? lower - 87 : -1
}

function isAlphanumeric(char: number): boolean {
    const lower = char | 0x20
    return (char >= 48 && char <= 57) || (lower >= 97 && lower <= 122)
}
