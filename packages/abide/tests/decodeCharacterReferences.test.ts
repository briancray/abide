// STATIC TEXT, DECODED BY HTML'S OWN RULES AT BUILD TIME. Each case is one edge the rules draw, and
// the answer is what a browser's parser makes of the same bytes — between an attribute's quotes for
// the ATTRIBUTE rule, between two tags for the TEXT rule. Every name in the list, each numeric
// range and both rules were checked against chromium once; these are the edges a regression would
// move.
//
// THE REVERTS: drop the `=`/alphanumeric check in `namedReference` — `&copy=2` decodes to `©=2` in
// an attribute and `&notin` to `¬in`; apply it under the text rule as well — `&notin` in text stays
// `&notin` where `¬in` is due; drop the `WINDOWS_1252` remap — `&#128;` reads `\u0080` where `€` is
// due; drop the U+FFFD clamp — `&#0;` reads `\u0000`; read the list as a plain lookup rather than
// `Object.hasOwn` — `&constructor;` decodes to `Object`'s source text.

import { expect, test } from 'bun:test'
import { decodeCharacterReferences } from '#compiler/decodeCharacterReferences.ts'

const attribute = (text: string): string =>
    decodeCharacterReferences(text, 'attribute')
const text = (source: string): string =>
    decodeCharacterReferences(source, 'text')

test('a named reference with its semicolon, and the longest name in the list', () => {
    expect(attribute('AT&amp;T')).toBe('AT&T')
    expect(attribute('&notin;')).toBe('∉')
    expect(attribute('&CounterClockwiseContourIntegral;')).toBe('∳')
})

test('a legacy name decodes without its semicolon where nothing follows it that could continue it', () => {
    expect(attribute('AT&amp T')).toBe('AT& T')
    expect(attribute('&copy')).toBe('©')
    expect(attribute('&lt;&gt')).toBe('<>')
    expect(attribute('&not.')).toBe('¬.')
})

test('the attribute exception: a bare name followed by = or a letter or digit stays as written', () => {
    expect(attribute('?a=1&copy=2')).toBe('?a=1&copy=2')
    expect(attribute('AT&ampT')).toBe('AT&ampT')
    expect(attribute('&copy2')).toBe('&copy2')
    // `notin` is not a legacy name, so the longest match is `not` — and `in` continues it.
    expect(attribute('&notin')).toBe('&notin')
    expect(attribute('&copy;2')).toBe('©2')
})

test('the text rule has no exception: the same bare names decode between two tags', () => {
    expect(text('&notin')).toBe('¬in')
    expect(text('?a=1&copy=2')).toBe('?a=1©=2')
    expect(text('AT&ampT')).toBe('AT&T')
    expect(text('&nosuch;')).toBe('&nosuch;')
})

test('a numeric reference, decimal or hex, with or without its semicolon', () => {
    expect(attribute('&#65;&#x42;&#X43&#68')).toBe('ABCD')
    expect(attribute('&#x1F600;')).toBe('😀')
    expect(attribute('&#;&#x;&#xg;')).toBe('&#;&#x;&#xg;')
})

test('0x80 to 0x9F are read as windows-1252, and a hole in that table stands for itself', () => {
    expect(attribute('&#128;&#x99;&#159;')).toBe('€™Ÿ')
    expect(attribute('&#x81;')).toBe('\u0081')
})

test('zero, a surrogate and anything past U+10FFFF are U+FFFD', () => {
    expect(attribute('&#0;')).toBe('�')
    expect(attribute('&#xD800;')).toBe('�')
    expect(attribute('&#x110000;')).toBe('�')
    expect(attribute('&#99999999999999999999;')).toBe('�')
})

test('a name the list does not hold is left as it is', () => {
    expect(attribute('&nosuch;')).toBe('&nosuch;')
    expect(attribute('&constructor;')).toBe('&constructor;')
    expect(attribute('a & b && c')).toBe('a & b && c')
})
