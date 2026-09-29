/**
 * Text percent-decoded, or as it came where it will not decode.
 *
 * A malformed escape names nothing better than its own spelling. Text with no `%` has nothing to
 * decode.
 */
export function decodedOrKept(text: string): string {
    if (!text.includes('%')) return text
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}
