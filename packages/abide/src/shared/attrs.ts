// What `class:name={cond}` and `style:prop={value}` become.
//
// A toggle cannot be its own slot: `class` is one attribute, so a template carrying a static class
// AND two toggles still has exactly one value to write, and the compiler hands the whole thing over
// here. Written as plain loops over a rest array rather than `filter().join()` — a class list is
// rebuilt on every wake of the element's binding, and the intermediate array a filter allocates is
// per-wake garbage the loop simply does not produce.
//
// Both return `null` for "nothing to write", which is the value an attribute slot already omits.

/** `classes('card', [big, 'big'], [open, 'open'])` → `'card big'`. */
export function classes(base: string, ...toggles: (readonly [unknown, string])[]): string | null {
    let out = base
    for (let i = 0; i < toggles.length; i++) {
        const toggle = toggles[i] as readonly [unknown, string]
        if (!toggle[0]) continue
        out = out === '' ? toggle[1] : `${out} ${toggle[1]}`
    }
    return out === '' ? null : out
}

/** `styles('color:red', ['width', w])` → `'color:red;width:12px'`. A nullish value drops. */
export function styles(base: string, ...pairs: (readonly [string, unknown])[]): string | null {
    let out = base
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i] as readonly [string, unknown]
        const value = pair[1]
        if (value === null || value === undefined || value === false) continue
        const declaration = `${pair[0]}:${value as string}`
        out = out === '' ? declaration : out.endsWith(';') ? out + declaration : `${out};${declaration}`
    }
    return out === '' ? null : out
}
