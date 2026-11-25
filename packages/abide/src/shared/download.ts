// 53.90, 53.91 — A FILE HANDED TO THE PERSON: text or bytes made in the page saved under a name, as
// a link to it clicked would save it. A server has no one to hand it to.

import { isServer } from './isServer.ts'

const RELEASE_AFTER = 40_000

/** Saves `data` as a file named `name`, as a click on a link to it would. */
export function download(
    data: Blob | string,
    name: string,
    type = 'text/plain',
): void {
    if (isServer())
        throw new Error(
            'download hands a file to a person, and a server has none to hand it to: answer a Response with a Content-Disposition instead. RULEBOOK 53.91.',
        )
    const blob = typeof data === 'string' ? new Blob([data], { type }) : data
    const address = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = address
    link.download = name
    link.rel = 'noopener'
    // In the document for the click: an engine may ignore one on a link outside it.
    document.body.append(link)
    link.click()
    link.remove()
    // A save may read the address long after the click — WebKit decides on a download, `abide
    // native`'s included (38.192), on a later turn — so it is released well after any read starts.
    setTimeout(() => URL.revokeObjectURL(address), RELEASE_AFTER)
}
