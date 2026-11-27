/** RFC 6901 — a property name as one token of a JSON Pointer: `~` written `~0`, and `/` written `~1`. */
export function pointerToken(name: string | number): string {
    return typeof name === 'number'
        ? String(name)
        : name.replaceAll('~', '~0').replaceAll('/', '~1')
}
