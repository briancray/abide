// 32.18 — WHICH FILES ANOTHER FILE INVOKES AS A COMPONENT, read off the imports the sources
// themselves wrote. A build knows its whole tree; an emitter sees one file, so this is the
// build's answer to hand it (`emitClient`'s `invoked`).
//
// BY FILE NAME rather than by resolved path: a `.abide` import is written against the app's own
// seams (`#ui/components/Total.abide`), and resolving those is the app's business rather than
// this function's. Two components of one name in one app is the case this cannot tell apart, and
// it answers that both are invoked — which costs a module its own markup and nothing else.
export function invokedComponents(sources: Iterable<string>): Set<string> {
    const invoked = new Set<string>()
    for (const text of sources)
        for (const match of text.matchAll(
            /from\s*'([^']*\.abide)'|from\s*"([^"]*\.abide)"/g,
        )) {
            const specifier = match[1] ?? match[2] ?? ''
            invoked.add(specifier.slice(specifier.lastIndexOf('/') + 1))
        }
    return invoked
}
