import { escapeAttribute } from '@abide/abide'

// A compact highlighter: enough to make a snippet scannable, not a parser. Order in the alternation
// is the precedence — a keyword inside a string stays a string.
const TOKEN =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('[^'\n]*'|"[^"\n]*"|`[^`]*`)|(\{[#:/][a-zA-Z]*)|(<\/?[a-zA-Z][\w-]*)|\b(import|from|export|const|let|return|async|await|function|if|else|new|typeof|of|in|true|false|null|undefined)\b|\b(\d[\d_]*)\b/g

const TOKEN_CLASS = ['comment', 'string', 'block', 'tag', 'key', 'num']

/** The code as escaped HTML, each token wrapped in a `t-<class>` span. */
export function highlight(code: string): string {
    let html = ''
    let last = 0
    TOKEN.lastIndex = 0
    for (let match = TOKEN.exec(code); match; match = TOKEN.exec(code)) {
        html += escapeAttribute(code.slice(last, match.index))
        let group = 0
        for (let index = 1; index < match.length; index += 1)
            if (match[index] !== undefined) {
                group = index
                break
            }
        html += `<span class="t-${TOKEN_CLASS[group - 1]}">${escapeAttribute(match[0])}</span>`
        last = match.index + match[0].length
    }
    return html + escapeAttribute(code.slice(last))
}

/** What a caption marks a slice of a file with, which is never part of its path. */
export const EXCERPT = ' — excerpt'

/**
 * Which side a caption names, as the spine colors it: a file path, or one of four words.
 *
 * A DIRECTORY DECIDES IT, as it decides what may import the file (16.29): under a `server`
 * directory is the server's, and everything else — a `.abide` file always — is BOTH SIDES.
 */
export function sideOf(caption: string): 'server' | 'abide' | 'browser' {
    const address = caption.replace(EXCERPT, '')
    if (
        address.endsWith('.abide') ||
        address === 'abide' ||
        address === 'shared'
    )
        return 'abide'
    const directories = address.split('/').slice(0, -1)
    if (
        address === 'server' ||
        address === '.env' ||
        directories.includes('server')
    )
        return 'server'
    if (address === 'browser') return 'browser'
    return address.startsWith('src/') ? 'abide' : 'browser'
}
