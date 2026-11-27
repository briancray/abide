// 43.48 — happy-dom's form reset puts back every field but a file input, which keeps the files picked:
// the HTML reset algorithm empties a file input's list of selected files. A form that starts over
// after a call (56.34) left the picked file standing under `bun test`, where a browser clears it.
// Setting `value` to `''` is the one write a file input takes, and happy-dom empties its files on it.

export function installFormReset(): void {
    const prototype = HTMLFormElement.prototype
    const reset = prototype.reset
    prototype.reset = function (this: HTMLFormElement): void {
        for (const element of this.elements)
            if (element instanceof HTMLInputElement && element.type === 'file')
                element.value = ''
        reset.call(this)
    }
}
