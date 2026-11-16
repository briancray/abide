/**
 * Whether `value` is plain data: an array, or an object whose prototype is `Object.prototype` or
 * `null`. What a copy reproduces whole and a proxy can stand in for — a `Map`, a `Date` or a class
 * instance carries state no own key holds.
 */
export function isPlainData(value: unknown): value is object {
    if (value === null || typeof value !== 'object') return false
    if (Array.isArray(value)) return true
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}
