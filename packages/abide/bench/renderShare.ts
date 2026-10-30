// WHERE THE SERVER RENDER'S TIME GOES, at 1000 cards. NAME THE SHARE BEFORE CHANGING THE LAYER:
// this splits the emitted shape into its parts and prices each against `vanillaMarkup`, which
// escapes by hand as the compiled page must (32.1). The `no escaping` row is the arm that does
// not, and it is not the same work — `benchRender.ts` says what an arm like it once claimed.

import { escapeText, reactive } from '@abide/abide'
import { batch, emulatedDom, type Sample } from '@abide/harness/report'

import { cards, vanillaMarkup } from './renderCases.ts'

const N = 1000
const list = cards(N)
const live = reactive(list)

function abideShape(): string {
    // What the compiler emits: one concatenation, a reactive READ per slot, escaped.
    let out = '<main id="list">'
    for (let at = 0; at < N; at += 1)
        out +=
            '<article class="card"><h2>' +
            escapeText(live()[at]?.title) +
            '</h2><p>' +
            escapeText(live()[at]?.body) +
            '</p><span class="n">' +
            escapeText(live()[at]?.count) +
            '</span></article>'
    return `${out}</main>`
}

function withoutReactive(): string {
    let out = '<main id="list">'
    for (let at = 0; at < N; at += 1)
        out +=
            '<article class="card"><h2>' +
            escapeText(list[at]?.title) +
            '</h2><p>' +
            escapeText(list[at]?.body) +
            '</p><span class="n">' +
            escapeText(list[at]?.count) +
            '</span></article>'
    return `${out}</main>`
}

function withoutEscaping(): string {
    let out = '<main id="list">'
    for (let at = 0; at < N; at += 1)
        out += `<article class="card"><h2>${list[at]?.title}</h2><p>${list[at]?.body}</p><span class="n">${list[at]?.count}</span></article>`
    return `${out}</main>`
}

/**
 * Compiles the whole page as one expression, one array join, or a run of appends.
 *
 * THE SHAPE A PAGE WRITTEN WITHOUT `{#for}` COMPILES TO: one expression with ~7000 operands, not
 * a loop. `{#for}` emits the loop, and `benchRender.ts` prices the two against each other.
 */
function build(kind: 'expression' | 'join' | 'append'): () => string {
    const pieces: string[] = []
    for (let at = 0; at < N; at += 1)
        pieces.push(
            `'<article class="card"><h2>'`,
            `e(d[${at}].title)`,
            `'</h2><p>'`,
            `e(d[${at}].body)`,
            `'</p><span class="n">'`,
            `e(d[${at}].count)`,
            `'</span></article>'`,
        )
    if (kind === 'expression')
        return new Function(
            'e',
            'd',
            `return '<main>' + ${pieces.join(' + ')} + '</main>'`,
        ).bind(null, escapeText, list) as () => string
    if (kind === 'join')
        return new Function(
            'e',
            'd',
            `return ['<main>', ${pieces.join(', ')}, '</main>'].join('')`,
        ).bind(null, escapeText, list) as () => string
    return new Function(
        'e',
        'd',
        `let s = '<main>'\n${pieces.map((piece) => `s += ${piece}`).join('\n')}\ns += '</main>'\nreturn s`,
    ).bind(null, escapeText, list) as () => string
}

const asExpression = build('expression')
const asJoin = build('join')
const asAppend = build('append')

const measured = batch({
    case: 'where a server render spends its time, 1000 cards',
    arms: {
        vanilla: (): void => {
            void vanillaMarkup(list)
        },
        'no escaping': (): void => {
            void withoutEscaping()
        },
        'escaping, no reactive read': (): void => {
            void withoutReactive()
        },
        'as emitted': (): void => {
            void abideShape()
        },
        'one expression (unrolled)': (): void => {
            void asExpression()
        },
        'array join': (): void => {
            void asJoin()
        },
        'append to a string': (): void => {
            void asAppend()
        },
    },
    emulated: emulatedDom(),
})

console.log('\nWHERE THE TIME GOES — 1000 cards, 3000 slots\n')
const base = (measured.samples.vanilla as Sample).nanoseconds
for (const [name, sample] of Object.entries(measured.samples))
    console.log(
        `  ${name.padEnd(28)} ${((sample as Sample).nanoseconds / 1000).toFixed(1)} µs   ${((sample as Sample).nanoseconds / base).toFixed(2)}x vanilla`,
    )
