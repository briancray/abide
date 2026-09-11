// THE SERVED SCRIPT IS OPAQUE TO THE COMPILER. It is a template literal, so
// typescript checks that the LITERAL is well formed and nothing at all about the
// JavaScript inside it — and a page whose script does not parse looks completely
// normal and does nothing.
//
// Six escaping mistakes have now gone through a seam of this shape, five of them a
// backtick inside a comment inside the literal. `checkInlineScripts` gates the docs
// page's own script at build; this gates the status page's.

import { expect, test } from 'bun:test'
import { STATUS_PAGE } from '../scripts/STATUS_PAGE.ts'
import { STATUS_SCRIPT } from '../scripts/STATUS_SCRIPT.ts'

// Reverted — drop the parse — a stray backtick ships and the page renders its shell,
// wires up no buttons, and reports nothing anywhere.
test('the status page script parses', () => {
    expect(() => new Function(STATUS_SCRIPT)).not.toThrow()
})

test('the status page ships no inline script to get wrong', () => {
    // The script is SERVED, not inlined, which is what keeps it to one layer of
    // quoting. A `<script>` with a body here would be the seam coming back.
    const inline = [...STATUS_PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inline).toEqual([])
    expect(STATUS_PAGE).toContain('<script src="/status.js">')
})

test('the page asks for every endpoint the server answers', () => {
    for (const endpoint of [
        '/api/run/unit',
        '/api/run/gates',
        '/api/run/browser',
        '/api/counted',
        '/api/machinery',
        '/api/measure',
    ])
        expect(STATUS_SCRIPT).toContain(endpoint)
})
