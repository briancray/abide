// The remap for a numeric reference in 0x80–0x9F, indexed from 0x80; 0 is none, and the number
// stands for itself.
const WINDOWS_1252 = [
    0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
    0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d,
    0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e,
    0x0178,
]

/**
 * The character a numeric character reference's number stands for, by the HTML spec: U+FFFD for
 * zero, a surrogate or past U+10FFFF (where `String.fromCodePoint` would throw), and the
 * windows-1252 remap for 0x80–0x9F.
 */
export function numericReferenceCharacter(code: number): string {
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return '�'
    if (code >= 0x80 && code <= 0x9f)
        return String.fromCodePoint(
            (WINDOWS_1252[code - 0x80] as number) || code,
        )
    return String.fromCodePoint(code)
}
