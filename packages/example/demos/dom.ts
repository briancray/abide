// Hand-written DOM helpers the demos use for their live areas.
//
// Deliberately not built with abide. The furniture must not be the thing under demonstration, or a
// bug in `$ui` would take the page that shows it off the air — and a reader could never tell which
// half of the screen was abide and which was scaffolding. It is also why these are safe to call from
// a headless `run`: they touch nothing but `document`.

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

const BUTTON =
    'rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700 ' +
    'active:bg-slate-600 border border-slate-700'

/** The small-caps ramp every caption, badge and column head in the demo pages shares. */
export const LABEL = 'text-[10px] uppercase tracking-widest'

/** The row-sized variant: a control that has to sit inside a table row without setting its height. */
export const SMALL_BUTTON =
    'rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 ' +
    'active:bg-slate-600 border border-slate-700'

export function button(label: string, onClick: () => void, className = BUTTON): HTMLButtonElement {
    const node = el('button', className, label)
    node.addEventListener('click', onClick)
    return node
}

export function row(...children: (globalThis.Node | string)[]): HTMLElement {
    const node = el('div', 'flex flex-wrap items-center gap-2')
    node.append(...children)
    return node
}

export function field(label: string, onInput: (value: string) => void, initial = ''): HTMLElement {
    const wrap = el('label', 'flex items-center gap-2 text-sm text-slate-400')
    wrap.append(document.createTextNode(label))
    const input = el('input', 'rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100')
    input.value = initial
    input.addEventListener('input', () => onInput(input.value))
    wrap.append(input)
    return wrap
}

/** A framed area a case renders live DOM into, so the reader can see what abide owns. */
export function stage(host: HTMLElement, label = 'live'): HTMLElement {
    const wrap = el('div', 'rounded-lg border border-dashed border-slate-700 bg-slate-900/60')
    wrap.append(el('div', `px-3 pt-2 ${LABEL} text-slate-600`, label))
    const inner = el('div', 'px-3 pb-3 pt-1')
    wrap.append(inner)
    host.append(wrap)
    return inner
}

/** A read-only pane for markup a case produced. */
export function output(host: HTMLElement, text = ''): HTMLPreElement {
    const pane = el(
        'pre',
        'rounded-lg border border-dashed border-slate-700 bg-slate-900/60 p-3 ' +
            'font-mono text-xs text-emerald-300 whitespace-pre-wrap break-all overflow-auto max-h-64',
    )
    pane.textContent = text
    host.append(pane)
    return pane
}
