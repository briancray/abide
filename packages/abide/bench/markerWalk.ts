/**
 * The script source that finds every slot under `root` by the markers scheme and leaves them on
 * `__SLOTS__`: the walk is over COMMENTS, and a slot's number is read off its marker.
 */
export function markerWalk(root: string): string {
    return `
const found = []
const walker = document.createTreeWalker(scope.querySelector('${root}'), NodeFilter.SHOW_COMMENT)
while (true) {
    const comment = walker.nextNode()
    if (comment === null) break
    const data = comment.data
    if (data.charCodeAt(0) !== 97 || data.length === 1) continue
    found[Number(data.slice(1))] = comment.nextSibling
}
globalThis.__SLOTS__ = found
`
}
