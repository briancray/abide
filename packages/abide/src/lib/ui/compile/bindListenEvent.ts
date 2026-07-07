/*
The DOM event a generic two-way `bind:<property>` listens on to write the bound
path back. Most form fields report edits via `input`, but a few properties are
driven by their own event and never fire `input` — `<details open>` fires
`toggle` and a checkbox/radio `checked` fires `change`. `<select value>` is NOT
handled here: generateBuild intercepts it before this function and routes it to
`bindSelectValue` (a MutationObserver-based helper that re-applies on late
options), so this function never sees that case.
*/
export function bindListenEvent(property: string): string {
    if (property === 'open') {
        return 'toggle'
    }
    if (property === 'checked') {
        return 'change'
    }
    return 'input'
}
