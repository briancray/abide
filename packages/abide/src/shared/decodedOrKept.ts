// PERCENT-DECODED, OR THE TEXT AS IT CAME where it will not decode — a malformed escape names
// nothing better than its own spelling. Text with no `%` has nothing to decode.
export function decodedOrKept(text: string): string {
    if (!text.includes('%')) return text
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}
