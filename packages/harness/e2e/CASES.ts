// THE CASE BODIES BOTH SUBSTRATES RUN, and they live apart from either arm so that
// "the same case" is a fact rather than two transcriptions. Each is self-contained —
// no closure, no import — because the browser arm receives it as source text and
// rebuilds it inside the page.
//
// A leaf: it has no imports of its own, so nothing about how a lane is wired can
// reach the thing the two lanes are supposed to agree about.
export const CASES: Record<string, () => void> = {
    // The one that decides whether the both-substrates claim survives. happy-dom
    // implements this in JavaScript over `removeChild` — 2 nested calls — and
    // Chromium in C++, where no JS-visible call happens.
    'a textContent write over two element children': () => {
        const host = document.createElement('div')
        host.appendChild(document.createElement('b'))
        host.appendChild(document.createElement('i'))
        document.body.appendChild(host)
        host.textContent = ''
    },
    // The other three aggregates the outermost-only rule was written for.
    'replaceChildren, append and cloneNode': () => {
        const host = document.createElement('div')
        host.appendChild(document.createElement('b'))
        document.body.appendChild(host)
        const fresh = document.createElement('i')
        host.replaceChildren(fresh)
        host.append(document.createElement('u'), 'tail')
        fresh.cloneNode(true)
    },
    // The one arm of the 69 that reaches class and style — `markup-class-style` —
    // and the reason both moved out of the refused list. happy-dom implements a CSS
    // property write over its own `setProperty`, which is patched; chromium and
    // webkit implement the property natively, where no JS-visible call happens.
    'a class toggle and four style writes': () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        host.classList.add('hot')
        host.classList.toggle('cold')
        host.style.paddingLeft = '4px'
        host.style.setProperty('color', 'red')
        host.style.removeProperty('color')
        host.style.cssText = 'margin:0'
    },
    // A two-row swap of a keyed list: the case that distinguishes a minimal keyed
    // reconcile from a rebuild, where a full reverse cannot.
    'a two-row swap': () => {
        const list = document.createElement('ul')
        const rows: HTMLElement[] = []
        for (let index = 0; index < 3; index += 1) {
            const row = document.createElement('li')
            row.appendChild(document.createComment('slot'))
            list.appendChild(row)
            rows.push(row)
        }
        document.body.appendChild(list)
        list.insertBefore(rows[2] as Node, rows[0] as Node)
        list.insertBefore(rows[0] as Node, rows[1] as Node)
    },
    // A TEMPLATE, because the compiled arm makes every row from one and this is the
    // shadowing case: happy-dom gives `HTMLTemplateElement` its own `innerHTML` where
    // Chromium leaves it on `Element`, so a declaration naming only `Element` counts
    // the write in a browser and throws on the parse's `createElementNS` under bun.
    'a template innerHTML and a clone of its row': () => {
        const template = document.createElement('template')
        template.innerHTML = '<li><span></span></li>'
        const row = template.content.firstChild as Node
        row.cloneNode(true)
    },
}
