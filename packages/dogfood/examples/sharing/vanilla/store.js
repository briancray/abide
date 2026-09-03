// The store module a key replaces: an owner, a subscriber list,
// and the lifetime question the module cannot answer — it is built
// when the file is first imported and lives as long as the
// process, whichever scope actually wanted it.
const listeners = new Set()
let currency = 'USD'

export function setCurrency(next) {
    currency = next
    for (const listener of listeners) listener(currency)
}

export function subscribe(listener) {
    listeners.add(listener)
    listener(currency)
    return () => listeners.delete(listener)
}
