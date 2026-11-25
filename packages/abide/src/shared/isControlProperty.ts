// 32.113 — the attributes a form control stops showing once it is used, kept written into the property
// of the same name: an `<input>`'s `value` and `checked`, a `<textarea>`'s `value`, an `<option>`'s
// `selected`. Every name lower-case, as an element's `localName` is.
const CONTROLS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ['input', new Set(['value', 'checked'])],
    ['textarea', new Set(['value'])],
    ['option', new Set(['selected'])],
])

/** 32.113 — whether `name` on a `tag` element is one of the control properties above. */
export function isControlProperty(tag: string, name: string): boolean {
    return CONTROLS.get(tag)?.has(name) ?? false
}

/** Whether a `tag` element has any control property above, so a spread asks per attribute only there. */
export function isControl(tag: string): boolean {
    return CONTROLS.has(tag)
}
