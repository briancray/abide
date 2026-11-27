// 43.47 — happy-dom's `<option>` has no `defaultSelected`, and its select lands on the wrong option
// when one is built from markup: its parser connects the first option before the marked one, the
// first is chosen as the default, and of the two then selected it keeps the one AT THE INDEX of the
// count less one rather than the last of them (a mark on the third option of four lands on the
// second). A select cloned out of a `<template>` keeps the index it never computed, -1. A form reads
// its baseline off `defaultSelected` (56.14), so under it every select read as edited at the first
// keystroke. This is the selectedness algorithm as the spec writes it, run where happy-dom runs its
// own, and `selectedIndex` read off the options rather than off a copy that can go stale.
//
// happy-dom keeps selectedness under its own symbols, which no export names; they are found by their
// descriptions, as `bridgeFiles` finds the one a `Blob` keeps its bytes under.

export function installSelect(): void {
    const optionPrototype = HTMLOptionElement.prototype
    if (Object.getOwnPropertyDescriptor(optionPrototype, 'defaultSelected'))
        return
    Object.defineProperty(optionPrototype, 'defaultSelected', {
        configurable: true,
        get(this: HTMLOptionElement) {
            return this.hasAttribute('selected')
        },
        set(this: HTMLOptionElement, selected: boolean) {
            this.toggleAttribute('selected', Boolean(selected))
        },
    })
    const symbolNamed = (holder: object, description: string): symbol => {
        const found = Object.getOwnPropertySymbols(holder).find(
            (symbol) => symbol.description === description,
        )
        if (found === undefined)
            throw new Error(
                `@abide/harness: happy-dom no longer keeps a select's '${description}' where installSelect reads it. RULEBOOK 43.47.`,
            )
        return found
    }
    const selectPrototype = HTMLSelectElement.prototype
    const UPDATE = symbolNamed(selectPrototype, 'updateSelectedness')
    const SELECTEDNESS = symbolNamed(
        document.createElement('option'),
        'selectedness',
    )
    type Held = HTMLOptionElement & Record<symbol, boolean>
    const optionsOf = (select: HTMLSelectElement): Held[] =>
        [...select.querySelectorAll('option')] as Held[]
    const disabled = (option: HTMLOptionElement): boolean =>
        option.disabled ||
        (option.parentElement instanceof HTMLOptGroupElement &&
            option.parentElement.disabled)
    // https://html.spec.whatwg.org/multipage/form-elements.html#selectedness-setting-algorithm
    Object.defineProperty(selectPrototype, UPDATE, {
        configurable: true,
        value(this: HTMLSelectElement, chosen?: HTMLOptionElement | null) {
            // A multiple select keeps every option picked: one picked leaves the others be.
            if (this.multiple) return
            const options = optionsOf(this)
            if (chosen)
                for (const option of options)
                    option[SELECTEDNESS] = option === chosen
            let last: Held | undefined
            for (const option of options)
                if (option[SELECTEDNESS]) last = option
            if (last !== undefined) {
                for (const option of options)
                    option[SELECTEDNESS] = option === last
                return
            }
            if (this.size > 1) return
            for (const option of options)
                if (!disabled(option)) {
                    option[SELECTEDNESS] = true
                    return
                }
        },
    })
    const selectedIndex = Object.getOwnPropertyDescriptor(
        selectPrototype,
        'selectedIndex',
    )
    Object.defineProperty(selectPrototype, 'selectedIndex', {
        ...selectedIndex,
        get(this: HTMLSelectElement) {
            const options = optionsOf(this)
            for (let index = 0; index < options.length; index++)
                if (options[index]?.[SELECTEDNESS]) return index
            return -1
        },
    })
}
