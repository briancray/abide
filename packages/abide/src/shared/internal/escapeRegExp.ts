// Neutralise every RegExp metacharacter in a literal, so a name/slug can be interpolated into a
// pattern. One owner: this was written out identically in three places (`analyzeBindings`,
// `emitCheck`, `clientBundle`) — three copies of one character class, where a single missed
// metacharacter is a pattern that silently matches the wrong thing rather than an error.
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
