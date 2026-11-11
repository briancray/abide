import { REGION_CLOSE, REGION_OPEN } from './ANCHORS.ts'

// The markup an anchor is WRITTEN as, for the server and the compiler. Never imported from the
// client's closure: the browser reads an anchor as a comment's data and builds one with
// `createComment`. The one string it writes is `markupRun`'s anchored text run (32.30), which spells
// its own pair rather than bring this module into every page.

/** An anchor's comment, from its data. */
export function anchorMarkup(data: string): string {
    return `<!--${data}-->`
}

/** `body` between a region's pair — a page (41.9), a component invocation (32.17). */
export function regionMarkup(body: string): string {
    return `${anchorMarkup(REGION_OPEN)}${body}${anchorMarkup(REGION_CLOSE)}`
}
