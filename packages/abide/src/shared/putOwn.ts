/**
 * Assigns `target[key] = value` as an own member, `__proto__` included.
 *
 * `__proto__` IS A SETTER ON `Object.prototype`, not a member, so `target[key] = value` for that
 * key re-parents the target and writes nothing. Every record here keyed by something the INPUT
 * named — a path step, a wire field, a refusal's path — is one runtime string away from it: a
 * write lost entirely, or a `state.pwned` that reads back while `JSON.stringify(state)` has never
 * heard of it. `defineProperty` makes the own member the assignment was meant to; a spread and
 * `JSON.stringify` already treat an own `__proto__` as a member, so only the assignment is told.
 */
export function putOwn(
    target: Record<string | number, unknown>,
    key: string | number,
    value: unknown,
): void {
    if (key === '__proto__')
        Object.defineProperty(target, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        })
    else target[key] = value
}
