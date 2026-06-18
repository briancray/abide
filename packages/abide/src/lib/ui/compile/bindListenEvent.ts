/*
The DOM event a generic two-way `bind:<property>` listens on to write the bound
path back. Most form fields report edits via `input`, but a few properties are
driven by their own event and never fire `input` — `<details open>` fires
`toggle`, a checkbox/radio `checked` fires `change`, and a `<select>` settles its
`value` on `change`. Picking the wrong event silently breaks the write-back.
*/
export function bindListenEvent(property: string, tag: string): string {
    if (property === 'open') {
        return 'toggle'
    }
    if (property === 'checked') {
        return 'change'
    }
    if (property === 'value' && tag === 'select') {
        return 'change'
    }
    return 'input'
}
