// 32.61 — AN OPTION'S VALUE READ AS THE BROWSER READS IT, so the server marks the option a script would.

import { expect, test } from 'bun:test'

import { selectedMarkup } from '#shared/boundValue.ts'

// THE REVERT: decode numeric references with a bare `String.fromCodePoint`; the render throws a
// RangeError.
test('a numeric reference no code point holds reads as U+FFFD rather than throwing — 32.61', () => {
    expect(selectedMarkup('<option value="&#9999999;">x</option>', '�')).toBe(
        '<option value="&#9999999;" selected>x</option>',
    )
})

// THE REVERT: require the `;`; `&#169` reads as written and nothing is selected.
test('a numeric reference with no semicolon is read — 32.61', () => {
    expect(selectedMarkup('<option value="&#169">x</option>', '©')).toBe(
        '<option value="&#169" selected>x</option>',
    )
})

// THE REVERT: collapse with `\s`; the no-break space is trimmed and the option is not selected.
test("an option's text keeps a no-break space and collapses ASCII whitespace — 32.61", () => {
    expect(selectedMarkup('<option> A</option>', ' A')).toBe(
        '<option selected> A</option>',
    )
    expect(selectedMarkup('<option>  b\n c </option>', 'b c')).toBe(
        '<option selected>  b\n c </option>',
    )
})
