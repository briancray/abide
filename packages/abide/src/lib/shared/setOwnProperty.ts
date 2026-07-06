/*
Assignment can't create an own `__proto__` key — it invokes the
Object.prototype accessor instead, silently dropping the key or (on decode of
attacker-controlled wire data) swapping the object's prototype. defineProperty
always writes an own enumerable data property, so `__proto__` round-trips as a
plain key. Plain assignment stays on the fast path for every other key.
*/
export function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
    if (key === '__proto__') {
        Object.defineProperty(target, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        })
        return
    }
    target[key] = value
}
