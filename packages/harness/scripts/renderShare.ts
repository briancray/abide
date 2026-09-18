// WHERE THE SERVER RENDER'S TIME GOES. 28x the hand-written arm at 1000 cards, and superlinear —
// 59 ns a card at 10 and 437 at 1000 — so something is worse than per-slot work. NAME THE SHARE
// BEFORE CHANGING THE LAYER: this splits the emitted shape into its parts and prices each.

import { escapeText, reactive } from 'abide'
import { batch, type Sample } from 'harness/report'
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

// THE SHAPE THE COMPILER ACTUALLY EMITS: one expression with ~7000 operands, not a loop. The
// real module measured 437 µs where the loop above measures 43, so the shape itself is the
// suspect rather than anything it does per slot.
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
        'one expression (what we emit)': (): void => {
            void asExpression()
        },
        'array join': (): void => {
            void asJoin()
        },
        'append to a string': (): void => {
            void asAppend()
        },
    },
    emulated: null,
})

console.log('\nWHERE THE TIME GOES — 1000 cards, 3000 slots\n')
const base = (measured.samples.vanilla as Sample).nanoseconds
for (const [name, sample] of Object.entries(measured.samples))
    console.log(
        `  ${name.padEnd(28)} ${((sample as Sample).nanoseconds / 1000).toFixed(1)} µs   ${((sample as Sample).nanoseconds / base).toFixed(2)}x vanilla`,
    )
