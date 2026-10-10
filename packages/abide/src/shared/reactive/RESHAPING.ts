// The array methods that change the array they are called on, which `recordWrites` intercepts to keep
// each as the JSON Patch it makes rather than the index writes it does underneath.
export const RESHAPING: ReadonlySet<string> = new Set([
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'fill',
    'copyWithin',
])
