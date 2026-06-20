import { effect } from '../effect.ts'

/*
Binds an element attribute to `read()`. A boolean true sets the bare attribute,
and false/null/undefined removes it (the standard present/absent semantics);
anything else is stringified. One effect per bound attribute, so only the
changed attribute touches the DOM.
*/
// @documentation plumbing
export function attr(element: Element, name: string, read: () => unknown): void {
    effect(() => {
        const value = read()
        if (value === false || value === null || value === undefined) {
            element.removeAttribute(name)
        } else {
            element.setAttribute(name, value === true ? '' : String(value))
        }
    })
}
