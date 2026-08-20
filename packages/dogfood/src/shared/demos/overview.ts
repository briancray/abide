// The hub. Three primitives, one template tag, two substrates — on one screen.

import { channel, html, memo, state, type TemplateResult, watch } from 'abide'
import { renderToString } from 'abide/server/internal'
import { scratch, sleep, suite } from 'harness'
import { tick } from 'harness/measure'
import { mount } from 'abide/ui'
import { button, field, output, row, stage } from './dom.ts'
import { META } from './SUITES.ts'

export default suite({
    ...META.overview,
    cases: [
        {
            title: 'the whole model, on one screen',
            note: '`state` owns a value · `memo` derives or loads one · `channel` receives them. Same import, same call, both sides — the component below is rendered to live DOM and to a string without changing a character of it. The list slot reads a load with no ceremony at all: a cold read signals, so the client paints nothing there until it lands and the server waits for it.',
            async run({ is }) {
                const count = state(0)
                const doubled = memo(() => count() * 2)
                const search = memo(async ({ q }: { q: string }) =>
                    ['alpha', 'beta', 'gamma'].filter((w) => w.includes(q)),
                )
                const filter = state('')
                const notices = channel<string>({ tail: 3 })

                const view = (): TemplateResult => html`
                    <div>
                        <p class=${() => (count() > 2 ? 'high' : 'normal')}>
                            count ${() => count()} · doubled ${() => doubled()}
                        </p>
                        <ul>
                            ${() =>
                                // No probe and no narrowing: a read with nothing to serve yet
                                // SIGNALS, so this thunk simply does not paint until the load lands.
                                search({ q: filter() })().map((word) => html`<li>${word}</li>`)}
                        </ul>
                        <p>${() => notices.chunks().join(' · ')}</p>
                    </div>
                `

                const host = scratch(view)
                is(
                    'the client painted the shell',
                    host.querySelector('p')?.textContent?.includes('count 0'),
                    true,
                )
                is('…and the cold slot painted nothing at all', host.querySelector('li'), null)
                await tick()
                is(
                    'then the load landed',
                    Array.from(host.querySelectorAll('li')).map((li) => li.textContent),
                    ['alpha', 'beta', 'gamma'],
                )

                count.set(3)
                notices.publish('count → 3')
                await tick()
                is('the memo followed', host.querySelector('p')?.textContent?.includes('doubled 6'), true)
                is('the attribute slot flipped', host.querySelector('p')?.getAttribute('class'), 'high')
                is('and the channel painted', host.querySelectorAll('p')[1]?.textContent, 'count → 3')

                // The SAME view, rendered as a snapshot. The slot is warm now, so SSR sees the data.
                const markup = await renderToString(view())
                is('the server rendered the same rows', markup.includes('<li>alpha</li>'), true)
                is('…and the same attribute', markup.includes('class="high"'), true)
                host.remove()
            },
            interact({ host, log }) {
                const count = state(0)
                const doubled = memo(() => count() * 2)
                const search = memo(async ({ q }: { q: string }) => {
                    await sleep(200)
                    return ['alpha', 'beta', 'gamma'].filter((word) => word.includes(q))
                })
                const filter = state('')
                const notices = channel<string>({ tail: 3 })

                const view = (): TemplateResult => html`
                    <div class="space-y-2">
                        <p class=${() => (count() > 2 ? 'text-brass' : 'text-ink')}>
                            count ${() => count()} · doubled ${() => doubled()}
                        </p>
                        <ul class="text-sm text-ink-soft">
                            ${() => search({ q: filter() })().map((word) => html`<li>${word}</li>`)}
                        </ul>
                        <p class="text-xs text-verdigris">${() => notices.chunks().join(' · ')}</p>
                    </div>
                `

                mount(stage(host), view)
                host.append(
                    row(
                        button('count + 1', () => {
                            count.set(count.peek()! + 1)
                            notices.publish(`count → ${count.peek()}`)
                        }),
                        field('filter', (value) => filter.set(value)),
                    ),
                )
                // The markup itself, and re-rendered inside an effect: a byte count asks to be taken
                // on trust, and a one-shot snapshot stops agreeing with the live half on the first
                // click — which is the claim this card is making.
                const pane = output(host)
                watch(() => {
                    void renderToString(view()).then((markup) => (pane.textContent = markup.trim()))
                })
                log('', 'the same component as the live half above, rendered to a string')
            },
        },
    ],
})
