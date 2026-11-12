// 43.36 — happy-dom gives an element its `popover` attribute and none of the methods that open one,
// and its selector engine matches no `:popover-open`. These are the methods, holding the open state
// beside the element, and `matches(':popover-open')` reading it — the selector a component asks
// whether its popover is showing with. A selector that only CONTAINS `:popover-open` still goes to
// happy-dom and matches nothing. `toggle` fires synchronously where a browser queues it, so a test
// sees it without waiting a task. Nothing here lays a popover out in a top layer.

export function installPopover(): void {
    const prototype = HTMLElement.prototype
    if (typeof prototype.showPopover === 'function') return
    const open = new WeakSet<Element>()
    const flip = (element: HTMLElement, opening: boolean): void => {
        if (!element.hasAttribute('popover')) {
            throw new DOMException(
                'Not supported on elements that do not have a valid value for the popover attribute',
                'NotSupportedError',
            )
        }
        if (open.has(element) === opening) return
        if (opening) open.add(element)
        else open.delete(element)
        const toggle = new Event('toggle')
        Object.assign(toggle, {
            oldState: opening ? 'closed' : 'open',
            newState: opening ? 'open' : 'closed',
        })
        element.dispatchEvent(toggle)
    }
    prototype.showPopover = function (this: HTMLElement) {
        flip(this, true)
    }
    prototype.hidePopover = function (this: HTMLElement) {
        flip(this, false)
    }
    prototype.togglePopover = function (
        this: HTMLElement,
        force?: boolean | object,
    ) {
        const opening = typeof force === 'boolean' ? force : !open.has(this)
        flip(this, opening)
        return opening
    }
    const matches = Element.prototype.matches
    Element.prototype.matches = function (this: Element, selector: string) {
        return selector.trim() === ':popover-open'
            ? open.has(this)
            : matches.call(this, selector)
    } as Element['matches']
}
