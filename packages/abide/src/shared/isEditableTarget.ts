// The input types a key press does not type into: a press on one of these is the page's to take.
const UNTYPED_INPUTS = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
])

/**
 * Whether a key event's target is somewhere the visitor is typing: a text field, a textarea, a
 * select, or an element `contenteditable` makes writable. 53.10.
 *
 * Read by tag rather than by `instanceof`, so an element from another frame answers the same.
 *
 * @param target what the event names as its `target`; `null` and a non-element are `false`
 */
export function isEditableTarget(target: EventTarget | null): boolean {
    if (target === null || !('tagName' in target)) return false
    const element = target as HTMLElement
    switch (element.tagName) {
        case 'TEXTAREA':
        case 'SELECT':
            return true
        case 'INPUT':
            return !UNTYPED_INPUTS.has((element as HTMLInputElement).type)
    }
    return element.isContentEditable === true
}
