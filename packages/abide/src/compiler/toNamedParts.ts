// 38.221 — THE MIGRATION ONTO PARTS NAMED FOR THE COMPONENT THEY ARE: a headless component hands back
// another's parts whole under that component's name (49.18), from the release this migration is keyed
// to on — `chat`'s `jump` is its `autoscroll`'s, `wizard`'s `progress` its `meter`, `breadcrumbs`'
// `overflow` its `menu`.
//
// A MEMBER IS RENAMED ONLY ON A NAME THE FILE BINDS TO THE CALL, since `jump`, `progress` and
// `overflow` are common words a member of anything else may be. The scan is a pattern over the whole
// file rather than a token walk, because a page reads the name in its markup as much as its script,
// and a Markdown fence binds and reads it in one sample.

const RENAMES = [
    { factory: 'chat', from: 'jump', to: 'autoscroll.jump' },
    { factory: 'wizard', from: 'progress', to: 'meter' },
    { factory: 'breadcrumbs', from: 'overflow', to: 'menu' },
] as const

/** 38.221 — `text` with each member these releases renamed read under its new name, where it is read off a name bound to its component's call. */
export function toNamedParts(text: string): string {
    let out = text
    for (const { factory, from, to } of RENAMES) {
        if (!out.includes(factory) || !out.includes(from)) continue
        const bound = new RegExp(
            `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=;]*)?=\\s*${factory}\\s*[(<]`,
            'g',
        )
        for (const [, name] of out.matchAll(bound)) {
            // The name itself — spread, `...talk`, but not a member of something else, `other.talk`;
            // `talk.autoscroll.jump` is past it (38.200).
            const read = new RegExp(
                `(?<![\\w$])(?<![^.]\\.)(${(name as string).replaceAll('$', '\\$')}\\s*\\??\\.\\s*)${from}\\b`,
                'g',
            )
            out = out.replace(read, `$1${to}`)
        }
    }
    return out
}
