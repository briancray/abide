// The comment markers the server writes around a slot and the client finds it by. A leaf, with no
// imports: both seams read it, and an import edge here would be paid on every page.
//
// TWO markers rather than one, and the reason is the parser: adjacent text nodes MERGE. With only
// an opening marker, `{count}: done` arrives as the single text node `5: done`, and writing the
// slot clobbers the static text beside it. A closing marker is what makes the slot its own node.
export const SLOT_OPEN = 'a'
export const SLOT_CLOSE = '/a'
// The attribute an element carrying a listener is found by. Written by the server emitter,
// removed by the client on hydration so it does not linger in the document.
export const ELEMENT_ATTRIBUTE = 'data-a'
