// 53.82, 53.83 — A FILE HANDED TO THE PERSON: text or bytes made in the page saved under a name, as
// a link to it clicked would save it. A server has no one to hand it to.

import { isServer } from './isServer.ts'

/** Saves `data` as a file named `name`, as a click on a link to it would. */
export function download(
    data: Blob | string,
    name: string,
    type = 'text/plain',
): void {
    if (isServer())
        throw new Error(
            'download hands a file to a person, and a server has none to hand it to: answer a Response with a Content-Disposition instead. RULEBOOK 53.83.',
        )
    const blob = typeof data === 'string' ? new Blob([data], { type }) : data
    const address = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = address
    link.download = name
    link.rel = 'noopener'
    link.click()
    // Released once the save has had the address; a click starts it in the same task.
    setTimeout(() => URL.revokeObjectURL(address), 0)
}
