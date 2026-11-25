/**
 * 32.113 — whether an attribute is one a form control stops showing once it is used, and is kept
 * written into the property of the same name: an `<input>`'s `value` and `checked`, a `<textarea>`'s
 * `value`, an `<option>`'s `selected`. Both names lower-case, as an element's `localName` is.
 */
export function isControlProperty(tag: string, name: string): boolean {
    switch (tag) {
        case 'input':
            return name === 'value' || name === 'checked'
        case 'textarea':
            return name === 'value'
        case 'option':
            return name === 'selected'
        default:
            return false
    }
}
