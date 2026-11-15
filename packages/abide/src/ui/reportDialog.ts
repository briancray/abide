// 48.9 — ABIDE'S OWN REPORT DIALOG: what a `ReportDraft` opens in where the app draws none of its own.
// Plain DOM, loaded only when a draft is opened, so a page that never reports never fetches it.

import { isFailed } from '#shared/Failed.ts'
import { watch } from '#shared/reactive/index.ts'
import type { ReportDraft } from '#shared/report.ts'

// Laid on by class rather than `style=`, so a page's own stylesheet can restyle the dialog.
const STYLE = `.abide-report{max-width:40rem;width:calc(100% - 2rem);font:inherit}
.abide-report form{display:grid;gap:.75rem}
.abide-report label{display:grid;gap:.25rem}
.abide-report pre{max-height:16rem;overflow:auto;white-space:pre-wrap;font-size:.8em;margin:0}
.abide-report menu{display:flex;justify-content:end;gap:.5rem;margin:0;padding:0}`

let styled = false

/** Shows `draft` in a modal dialog: the summary and the description to write, and every word that is sent. */
export function reportDialog(draft: ReportDraft): void {
    if (!styled) {
        const style = document.createElement('style')
        style.textContent = STYLE
        document.head.append(style)
        styled = true
    }
    const dialog = document.createElement('dialog')
    dialog.className = 'abide-report'
    const form = document.createElement('form')
    form.method = 'dialog'
    const summary = labelled(
        form,
        'What went wrong',
        document.createElement('input'),
    )
    summary.value = draft.summary.peek() ?? ''
    summary.addEventListener('input', () => draft.summary.set(summary.value))
    const description = labelled(
        form,
        'What you were doing',
        document.createElement('textarea'),
    )
    description.rows = 4
    description.value = draft.description.peek() ?? ''
    description.addEventListener('input', () =>
        draft.description.set(description.value),
    )
    const heading = document.createElement('p')
    heading.textContent = 'This is everything that will be sent:'
    const preview = document.createElement('pre')
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    const actions = document.createElement('menu')
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    const send = document.createElement('button')
    send.type = 'submit'
    send.textContent = 'Send'
    actions.append(cancel, send)
    form.append(heading, preview, status, actions)
    dialog.append(form)
    // 48.7 — the preview is the draft's own text, so what is shown is what is sent.
    const stop = watch(() => {
        preview.textContent = draft.markdown()
    })
    const close = (): void => {
        stop()
        dialog.close()
        dialog.remove()
    }
    cancel.addEventListener('click', close)
    form.addEventListener('submit', (event) => {
        event.preventDefault()
        send.disabled = true
        status.textContent = 'Sending…'
        draft.send().then(close, (thrown: unknown) => {
            // 48.8 — the draft stands as it was, to be sent again.
            send.disabled = false
            status.textContent = `Not sent: ${isFailed(thrown) || thrown instanceof Error ? thrown.message : String(thrown)}`
        })
    })
    document.body.append(dialog)
    dialog.showModal()
}

function labelled<Field extends HTMLInputElement | HTMLTextAreaElement>(
    form: HTMLFormElement,
    text: string,
    field: Field,
): Field {
    const label = document.createElement('label')
    label.append(text, field)
    form.append(label)
    return field
}
