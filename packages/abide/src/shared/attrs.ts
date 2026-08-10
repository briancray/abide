// What `class:name={cond}` and `style:prop={value}` become.
//
// A toggle cannot be its own slot: `class` is one attribute, so a template carrying a static class
// AND two toggles still has exactly one value to write, and the compiler hands the whole thing over
// here. Written as plain loops over a rest array rather than `filter().join()` — a class list is
// rebuilt on every wake of the element's binding, and the intermediate array a filter allocates is
// per-wake garbage the loop simply does not produce.
//
// The NAMES come in as one array and the conditions as the rest, because the names are static: the
// compiler hoists the array to module scope, so a wake allocates one rest array where passing
// `[cond, name]` pairs allocated a two-element tuple per toggle as well — N+1 where one will do.
//
// Both return `null` for "nothing to write", which is the value an attribute slot already omits.

/** `classes('card', $names, big(), open())` with `$names = ['big', 'open']` → `'card big'`. */
export function classes(base: string, names: readonly string[], ...conditions: unknown[]): string | null {
    let out = base
    for (let i = 0; i < names.length; i++) {
        if (!conditions[i]) continue
        const name = names[i] as string
        out = out === '' ? name : `${out} ${name}`
    }
    return out === '' ? null : out
}

/** `styles('color:red', $names, w())` with `$names = ['width']` → `'color:red;width:12px'`. A nullish value drops. */
export function styles(base: string, names: readonly string[], ...values: unknown[]): string | null {
    let out = base
    for (let i = 0; i < names.length; i++) {
        const value = values[i]
        if (value === null || value === undefined || value === false) continue
        const declaration = `${names[i] as string}:${value as string}`
        out = out === '' ? declaration : out.endsWith(';') ? out + declaration : `${out};${declaration}`
    }
    return out === '' ? null : out
}
