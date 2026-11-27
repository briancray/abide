// 35.20-35.24 — A PLACE A LAYOUT OWNS, FILLED FROM BELOW IT: a page's toolbar actions, a section's
// side panel. `outlet.host` is spread on the element that holds them, and `outlet.into` on each
// element a page writes for it, inline, closing over the page's own state — and the element is moved
// into the host once the browser has it.
//
// THE SERVER WRITES AN `into` WHERE THE PAGE WROTE IT, `hidden`, and hydration adopts it there as it
// adopts anything else: no node is where the hydrating walk does not expect it, so nothing mismatches.
// The move is its element binding's (32.99), which a server never runs — so what is filled shows once
// the page is hydrated, and is never shown in the wrong place before then (35.21).
//
// THE HOST PLACES, NOT THE `into`. Each host's watch appends what is filled into its name in the
// order it was filled: appending a child it holds moves it to the end, so a pass in that order IS the
// order (35.20), however the hosts standing change. An `into` moved out of its own region is outside
// the markers that region removes between, so its own binding's `Disposer` takes it out.

import { namedLogger } from './log.ts'
import { reactive } from './reactive/index.ts'
import { type Disposer, watch } from './reactive/watch.ts'
import { register } from './register.ts'

/** An element standing under a name: a host, or an element filled into one. */
type Standing = { name: string; element: Element }

// One per request on a server, as every `reactive` without `global` is (11.32) — and only a browser
// ever registers, since only a browser runs an element binding.
const hosts = reactive<readonly Standing[]>([])
const filled = reactive<readonly Standing[]>([])

const OUTLET_LOG = namedLogger('abide:outlet')
let warned = false

/** 35.22 — the host that shows a name's elements: the last standing under it. */
function showing(name: string): Standing | undefined {
    let last: Standing | undefined
    for (const host of hosts.get()) if (host.name === name) last = host
    return last
}

// BOTH PARTS ARE FIXED RECORDS, their state written by their bindings: a getter reading the hosts
// would rerun the spread, and a spread written `{...outlet.host('x')}` makes its part again on each
// run — a fresh binding, and the host it registered standing beside the one it replaced. So the
// server writes each part's state as it stands before any binding runs, `data-empty` and `hidden`,
// and the browser keeps it from there.

/**
 * The part for the element that holds what `outlet.into` fills under `name`: `data-empty` while it
 * holds none. Of several standing under one name, the last holds them (35.22).
 *
 * @param name the name `outlet.into` fills
 */
export function host(name: string): Record<string, unknown> {
    return {
        'data-outlet': 'host',
        'data-empty': '',
        'bind:element': (element: Element): Disposer => {
            const standing: Standing = { name, element }
            const unregister = register(hosts, standing)
            const stop = watch(() => {
                const holds = showing(name) === standing
                // A DOM move costs more than the compare deciding it: nothing moves while the order
                // holds, and from the first element out of place every one after it is appended.
                let moving = false
                let previous: Element | undefined
                for (const each of filled.get()) {
                    if (each.name !== name || !holds) continue
                    if (
                        !moving &&
                        (each.element.parentNode !== element ||
                            (previous !== undefined &&
                                previous.nextSibling !== each.element))
                    )
                        moving = true
                    if (moving) element.append(each.element)
                    previous = each.element
                }
                element.toggleAttribute('data-empty', previous === undefined)
            })
            return () => {
                stop()
                unregister()
            }
        },
    }
}

/**
 * The part moving the element it is spread on into the `outlet.host` standing under `name`, for as
 * long as it is bound: `hidden` until a host holds it, the server's markup included.
 *
 * @param name the name of the host it is moved into
 */
export function into(name: string): Record<string, unknown> {
    return {
        'data-outlet': 'into',
        hidden: true,
        'bind:element': (element: Element): Disposer => {
            const unregister = register(filled, { name, element })
            const stop = watch(() => {
                element.toggleAttribute('hidden', showing(name) === undefined)
            })
            // 35.24 — looked at a task on, once the layout around the page has bound its hosts.
            setTimeout(() => unhosted(name), 0)
            return () => {
                stop()
                unregister()
                element.remove()
            }
        },
    }
}

function unhosted(name: string): void {
    if (warned) return
    for (const host of hosts.peek() ?? []) if (host.name === name) return
    warned = true
    OUTLET_LOG.warning(
        `outlet.into('${name}') has no outlet.host('${name}') standing to hold it. RULEBOOK 35.24.`,
    )
}
