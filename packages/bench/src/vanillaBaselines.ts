// THE VANILLA-JS BASELINE CORPUS — a hand-written, framework-free equivalent of each scenario in
// `scenarios.ts`, keyed by scenario name and timed by the SAME harness (`measure`) on the SAME machine
// in the SAME process. That makes every abide number readable as a MULTIPLE of what the identical work
// costs with no framework at all: `× vanilla = abide ns/op ÷ vanilla ns/op`.
//
// Why a baseline and not just absolute ns: absolute numbers are machine-specific and go stale. A ratio
// against hand-written JS is hardware-neutral, and it separates abide's cost from the substrate's — the
// `mount` numbers in particular are dominated by the DOM backend (happy-dom in the CLI, the real DOM in
// the browser), and only the ratio says how much of that is the framework.
//
// The rules that keep a baseline honest:
//   • SAME OUTPUT. Each baseline must produce DOM/markup equivalent to the scenario's (modulo abide's
//     hydration comment anchors). The CLI runner asserts this before timing and fails loudly on drift.
//   • SAME OP. `mount` builds the subtree AND tears it down, exactly as the abide op does; `update`
//     performs one equivalent mutation and awaits the same two-microtask flush, so harness overhead
//     cancels out of both sides.
//   • WHAT A PERSON WOULD WRITE. Idiomatic hand-written code — string concatenation for markup,
//     `createElement`/`textContent` for DOM, a reused node array for the keyed reverse. Not a
//     hand-tuned strawman in either direction. Interpolations go in unescaped (the corpus values are
//     safe), which is what a hand-written page does and abide does not — a small, deliberate handicap
//     on abide's side.
//
// Deliberately INLINE and STABLE for the same reason the scenarios are: changing one breaks historical
// comparability.

export interface VanillaBaseline {
    // What the hand-written version does — shown next to the ratio.
    note: string
    // Build the same markup as the scenario's SSR render. Absent for interaction-only scenarios.
    render?: (scope: Record<string, unknown>) => Promise<string> | string
    // Build the same DOM into `host` and return a teardown, mirroring abide's `mount(host, scope)`.
    mount: (host: HTMLElement, scope: Record<string, unknown>) => () => void
    // One equivalent mutation over a mounted host. Present only where the scenario has an `update`.
    update?: (host: HTMLElement) => Promise<void>
}

// Match the scenarios' flush so the timed region has identical await overhead on both sides.
async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

function teardown(host: HTMLElement): () => void {
    return () => {
        host.replaceChildren()
    }
}

// `<ul>{#for n of items by n}<li>row {n}</li>{/for}</ul>` — shared by all three list sizes.
const LIST: VanillaBaseline = {
    note: 'string concat / createElement loop',
    render: (scope) => {
        const items = scope.items as number[]
        let out = '<ul>'
        for (let i = 0; i < items.length; i++) out += `<li>row ${items[i]}</li>`
        return `${out}</ul>`
    },
    mount: (host, scope) => {
        const items = scope.items as number[]
        const list = document.createElement('ul')
        for (let i = 0; i < items.length; i++) {
            const row = document.createElement('li')
            row.textContent = `row ${items[i]}`
            list.appendChild(row)
        }
        host.appendChild(list)
        return teardown(host)
    },
}

export const VANILLA_BASELINES: Record<string, VanillaBaseline> = {
    'static-text': {
        note: 'literal string / one createElement',
        render: () => '<p>hello world</p>',
        mount: (host) => {
            const paragraph = document.createElement('p')
            paragraph.textContent = 'hello world'
            host.appendChild(paragraph)
            return teardown(host)
        },
    },

    interpolation: {
        note: 'template literal / textContent',
        render: (scope) => `<p>Hi ${scope.name}, you have ${scope.count} messages</p>`,
        mount: (host, scope) => {
            const paragraph = document.createElement('p')
            paragraph.textContent = `Hi ${scope.name}, you have ${scope.count} messages`
            host.appendChild(paragraph)
            return teardown(host)
        },
    },

    attributes: {
        note: 'template literal / setAttribute ×4',
        render: (scope) =>
            `<a id="${scope.id}" href="${scope.href}" title="${scope.title}" class="${scope.cls}">link</a>`,
        mount: (host, scope) => {
            const anchor = document.createElement('a')
            anchor.setAttribute('id', scope.id as string)
            anchor.setAttribute('href', scope.href as string)
            anchor.setAttribute('title', scope.title as string)
            anchor.setAttribute('class', scope.cls as string)
            anchor.textContent = 'link'
            host.appendChild(anchor)
            return teardown(host)
        },
    },

    'if-else': {
        note: 'ternary / branch on a boolean',
        render: (scope) => (scope.show ? `<p>${scope.msg}</p>` : '<p>hidden</p>'),
        mount: (host, scope) => {
            const paragraph = document.createElement('p')
            paragraph.textContent = scope.show ? (scope.msg as string) : 'hidden'
            host.appendChild(paragraph)
            return teardown(host)
        },
    },

    'for-list-100': LIST,
    'for-list-1000': LIST,
    'for-list-10000': LIST,

    'nested-for-if-50': {
        note: 'nested loop + branch, string concat / createElement',
        render: (scope) => {
            const rows = scope.rows as { id: number; on: boolean }[]
            let out = ''
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!
                out += row.on
                    ? `<section><b>${row.id}</b></section>`
                    : `<section><i>${row.id}</i></section>`
            }
            return out
        },
        mount: (host, scope) => {
            const rows = scope.rows as { id: number; on: boolean }[]
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!
                const section = document.createElement('section')
                const inner = document.createElement(row.on ? 'b' : 'i')
                inner.textContent = String(row.id)
                section.appendChild(inner)
                host.appendChild(section)
            }
            return teardown(host)
        },
    },

    switch: {
        note: 'switch statement',
        render: (scope) => {
            switch (scope.color) {
                case 'red':
                    return '<p>red</p>'
                case 'blue':
                    return '<p>blue</p>'
                default:
                    return '<p>other</p>'
            }
        },
        mount: (host, scope) => {
            const paragraph = document.createElement('p')
            switch (scope.color) {
                case 'red':
                    paragraph.textContent = 'red'
                    break
                case 'blue':
                    paragraph.textContent = 'blue'
                    break
                default:
                    paragraph.textContent = 'other'
            }
            host.appendChild(paragraph)
            return teardown(host)
        },
    },

    'class-style-directives': {
        note: 'conditional class string / classList + style',
        render: (scope) => {
            let classes = ''
            if (scope.active) classes += 'active'
            if (scope.big) classes += classes === '' ? 'big' : ' big'
            return `<div class="${classes}" style="color: ${scope.hue}; width: ${scope.width}">box</div>`
        },
        mount: (host, scope) => {
            const box = document.createElement('div')
            box.classList.toggle('active', scope.active === true)
            box.classList.toggle('big', scope.big === true)
            box.style.setProperty('color', scope.hue as string)
            box.style.setProperty('width', scope.width as string)
            box.textContent = 'box'
            host.appendChild(box)
            return teardown(host)
        },
    },

    'await-block': {
        note: 'await the promise / .then swap',
        render: async (scope) => `<p>${await (scope.p as Promise<string>)}</p>`,
        // The hand-written equivalent of an await block: paint the pending branch, swap it for the
        // resolved one when the promise settles. Like abide's mount, the swap lands a microtask later.
        mount: (host, scope) => {
            let live = true
            const pending = document.createElement('em')
            pending.textContent = 'loading'
            host.appendChild(pending)
            void (scope.p as Promise<string>).then((value) => {
                if (!live) return
                const resolved = document.createElement('p')
                resolved.textContent = value
                host.replaceChildren(resolved)
            })
            return () => {
                live = false
                host.replaceChildren()
            }
        },
    },

    'state-update': {
        note: 'a local counter + one textContent write',
        mount: (host) => {
            let count = 0
            const button = document.createElement('button')
            button.textContent = '+'
            const output = document.createElement('span')
            output.textContent = String(count)
            button.addEventListener('click', () => {
                count++
                output.textContent = String(count)
            })
            host.appendChild(button)
            host.appendChild(output)
            return teardown(host)
        },
        update: async (host) => {
            host.querySelector('button')?.click()
            await flush()
        },
    },

    'list-append-update': {
        note: 'push + appendChild one <li>',
        mount: (host) => {
            const items: number[] = [0]
            const button = document.createElement('button')
            button.textContent = 'add'
            const list = document.createElement('ul')
            const first = document.createElement('li')
            first.textContent = '0'
            list.appendChild(first)
            button.addEventListener('click', () => {
                items.push(items.length)
                const row = document.createElement('li')
                row.textContent = String(items.length - 1)
                list.appendChild(row)
            })
            host.appendChild(button)
            host.appendChild(list)
            return teardown(host)
        },
        update: async (host) => {
            host.querySelector('button')?.click()
            await flush()
        },
    },

    'list-reverse-1000': {
        note: 'reverse a node array + re-append (moves, no rebuild)',
        mount: (host) => {
            const button = document.createElement('button')
            button.textContent = 'rev'
            const list = document.createElement('ul')
            const nodes: HTMLElement[] = []
            for (let i = 0; i < 1000; i++) {
                const row = document.createElement('li')
                row.textContent = String(i)
                list.appendChild(row)
                nodes.push(row)
            }
            button.addEventListener('click', () => {
                nodes.reverse()
                for (let i = 0; i < nodes.length; i++) list.appendChild(nodes[i]!)
            })
            host.appendChild(button)
            host.appendChild(list)
            return teardown(host)
        },
        update: async (host) => {
            host.querySelector('button')?.click()
            await flush()
        },
    },

    'if-toggle': {
        note: 'swap one <p> for the other branch',
        mount: (host) => {
            let on = true
            const button = document.createElement('button')
            button.textContent = 't'
            const first = document.createElement('p')
            first.textContent = 'A'
            host.appendChild(button)
            host.appendChild(first)
            button.addEventListener('click', () => {
                on = !on
                const next = document.createElement('p')
                next.textContent = on ? 'A' : 'B'
                host.lastElementChild?.replaceWith(next)
            })
            return teardown(host)
        },
        update: async (host) => {
            host.querySelector('button')?.click()
            await flush()
        },
    },
}
