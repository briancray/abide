import { isIdentStart } from './isIdentStart.ts'

/* True when `c` can continue a JavaScript identifier — an identifier-start char or a digit. */
export function isIdentPart(c: string | undefined): boolean {
    if (c === undefined) {
        return false
    }
    return isIdentStart(c) || (c >= '0' && c <= '9')
}
