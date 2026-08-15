// Hand-written DOM helpers the demos use for their live areas.
//
// Deliberately not built with abide, and the reason is no longer that the page around them isn't:
// the site IS an abide app now — `site/card.abide` renders every card these fill in. What stays
// hand-written is the inside of a CASE, because a case is a comparison. A demo mounts abide into one
// of these and a bench arm builds the same thing by hand beside it, so furniture that was itself
// abide would put the subject on both sides of the measurement.
//
// It is also why these are safe to call from a headless `run`: they touch nothing but `document`.

/**
 * `make`, run on the first call and never again.
 *
 * Every suite module is imported on the SERVER too — the cards' titles and notes are server-rendered
 * — and a fixture built at module scope would touch `document` where there is none. An arm is the
 * only caller and an arm only ever runs in a browser, so deferring costs one null check and is the
 * difference between a suite that imports and one that throws on the way in.
 *
 * `null` is not a value any caller here holds, so it doubles as "not built yet" without a flag.
 */
export function lazy<T>(make: () => T): () => T {
    let held: T | null = null
    return (): T => {
        held ??= make()
        return held
    }
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = '',
    attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (className !== '') node.className = className
    if (text !== '') node.textContent = text
    for (const name in attrs) node.setAttribute(name, attrs[name] as string)
    return node
}

const BUTTON = 'demo-button'

/** The row-sized variant: a control that has to sit inside a table row without setting its height. */
export const SMALL_BUTTON = 'demo-button is-small'

export function button(label: string, onClick: () => void, className = BUTTON): HTMLButtonElement {
    const node = el('button', className, label)
    node.addEventListener('click', onClick)
    return node
}

export function row(...children: (globalThis.Node | string)[]): HTMLElement {
    const node = el('div', 'demo-row')
    node.append(...children)
    return node
}

export function field(label: string, onInput: (value: string) => void, initial = ''): HTMLElement {
    const wrap = el('label', 'demo-field')
    wrap.append(document.createTextNode(label))
    const input = el('input', '')
    input.value = initial
    input.addEventListener('input', () => onInput(input.value))
    wrap.append(input)
    return wrap
}

/** A framed area a case renders live DOM into, so the reader can see what abide owns. */
export function stage(host: HTMLElement, label = 'live'): HTMLElement {
    const wrap = el('div', 'demo-host')
    // `label` is the small-caps ramp, the same class the tables reach through `site/table.ts`.
    wrap.append(el('div', 'demo-host-label label', label))
    const inner = el('div', 'demo-host-body')
    wrap.append(inner)
    host.append(wrap)
    return inner
}

/** A read-only pane for markup a case produced. */
export function output(host: HTMLElement, text = ''): HTMLPreElement {
    const pane = el('pre', 'demo-out')
    pane.textContent = text
    host.append(pane)
    return pane
}
