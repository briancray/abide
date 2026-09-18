// The comment markers the server writes around a slot and the client finds it by. A leaf, with no
// imports: both seams read it, and an import edge here would be paid on every page.
//
// THE NUMBER IS IN THE MARKER, not in the order the markers are met. A slot found by counting
// from the top of the page is addressed by something the page's own SHAPE decides: `{#if}`
// removes a region and shifts every slot after it (32.13), `{#for}` repeats one N times (32.14),
// and 32.16 does it as chunks arrive. Numbering them makes an absent slot absent rather than a
// renumbering of everything that follows.
//
// THE NUMBER IS LOCAL TO A REGION, which is the other half and the reason this can grow. Every
// region — a page today, a branch body and a list row tomorrow — numbers its own slots from zero
// and the client only ever walks WITHIN one. Two rows of a list both hold `a0`, and neither can
// see the other's.
//
// TWO markers rather than one, because adjacent text nodes MERGE: with only an opening marker,
// `{count}: done` arrives as the single text node `5: done` and writing the slot clobbers the
// static text beside it. The closing marker carries no number — it is a fence, not an address.
export const SLOT_OPEN = 'a'
export const SLOT_CLOSE = '/a'
// The attribute an element carrying a listener is found by, numbered within its region for the
// same reason. Removed by the client on hydration so it does not linger in the document.
export const ELEMENT_ATTRIBUTE = 'data-a'
