// 33.23, 33.24 — `Attributes<Tag>` HOLDS A CALLER TO WHAT AN ELEMENT TAKES, and to nothing narrower than
// what writes the attribute. Each line below that compiles is one a first derivation refused in a
// real app — microdata, `aria-disabled` given a boolean, `spellcheck` given its text, an
// `autocomplete` held as a string, `form` naming its form — and each `@ts-expect-error` is one it
// must still refuse. THE REVERT: read `Attributes` straight off the DOM types, with no `Written` and no
// added attributes; `bun run typecheck` refuses each of the four allowed records in this file. And map
// over `keyof` rather than `Named`, and the form's and the select's records are refused: their index
// signatures collapse every named key into one.

import { expect, test } from 'bun:test'

import type { Attributes } from '#shared'

test('Attributes admits what writes an attribute, and refuses what an element lacks — 33.23, 33.24', () => {
    const button: Attributes<'button'> = {
        type: 'submit',
        disabled: true,
        class: 'p-2',
        tabindex: '-1',
        form: 'checkout',
        style: 'color: red',
        'aria-disabled': true,
        'aria-label': 'Buy',
        itemprop: 'name',
        itemscope: true,
        spellcheck: 'false',
        'data-id': 7,
        onclick: (event) => {
            const at: number = event.clientX
            const pressed: HTMLButtonElement = event.currentTarget
            void at
            void pressed
        },
    }
    const input: Attributes<'input'> = {
        autocomplete: 'off',
        readonly: true,
        maxlength: 3,
        list: 'suggestions',
    }
    const link: Attributes<'a'> = { href: '/a', target: '_blank', download: '' }
    const label: Attributes<'label'> = { for: 'email' }
    // A form's and a select's index signatures are their controls and options, not attributes.
    const form: Attributes<'form'> = {
        class: 'grid',
        action: '/save',
        novalidate: true,
    }
    const select: Attributes<'select'> = { class: 'w-full', multiple: true }
    // @ts-expect-error — not an attribute of a form.
    const formName: Attributes<'form'> = { hrefx: '/a' }
    // @ts-expect-error — not a `type` a button takes.
    const wrongType: Attributes<'button'> = { type: 'banana' }
    // @ts-expect-error — not an attribute of a button.
    const wrongName: Attributes<'button'> = { hrefx: '/a' }
    // @ts-expect-error — `for` is a label's, not an input's.
    const misplaced: Attributes<'input'> = { for: 'email' }
    // @ts-expect-error — `disabled` is read by presence, so its text would disable it.
    const presence: Attributes<'button'> = { disabled: 'false' }
    expect([button, input, link, label, form, select].length).toBe(6)
    void [wrongType, wrongName, misplaced, presence, formName]
})

// 33.26 — AN SVG ELEMENT TAKES THE SVG ATTRIBUTES, under the names SVG spells them, a length as a
// number or its text, and its listeners typed by that element. THE REVERT: type an SVG tag by the
// HTML derivation; its attributes are read-only animated values there, and the three SVG records
// below are refused.
test('Attributes types an SVG element by the SVG attributes — 33.26', () => {
    const svg: Attributes<'svg'> = {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        width: 24,
        class: 'size-6',
        'aria-hidden': true,
        focusable: 'false',
    }
    const circle: Attributes<'circle'> = {
        cx: 12,
        cy: '12',
        r: 4,
        fill: 'currentColor',
        'stroke-width': 1.5,
        'data-id': 1,
        onclick: (event) => {
            const at: number = event.clientX
            const pressed: SVGCircleElement = event.currentTarget
            void at
            void pressed
        },
    }
    const path: Attributes<'path'> = {
        d: 'M0 0L24 24',
        'stroke-linecap': 'round',
    }
    // `a` is the HTML element, as it is outside an `<svg>`.
    const link: Attributes<'a'> = { href: '/a', target: '_blank' }
    // @ts-expect-error — not an SVG attribute.
    const wrongName: Attributes<'circle'> = { radius: 4 }
    expect([svg, circle, path, link].length).toBe(4)
    void wrongName
})
