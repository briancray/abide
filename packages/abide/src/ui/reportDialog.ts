// 48.9 — ABIDE'S OWN REPORT DIALOG: what a `ReportDraft` opens in where the app draws none of its own.
// Plain DOM, loaded only when a draft is opened, so a page that never reports never fetches it. It
// carries no stylesheet and no class, as a headless part does not (49): each piece is named by
// `data-report`, which the app's own stylesheet styles.

import { isFailed } from '#shared/Failed.ts'
import { messageOf } from '#shared/messageOf.ts'
import { watch } from '#shared/reactive/index.ts'
import type { ReportDraft } from '#shared/report.ts'

/**
 * Shows `draft` in a modal dialog — the summary and the description to write, and every word that is
 * sent — settling `true` once it is sent, and `false` where it is closed unsent.
 */
export function reportDialog(draft: ReportDraft): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-report', 'dialog')
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
    preview.setAttribute('data-report', 'preview')
    const status = document.createElement('p')
    status.setAttribute('data-report', 'status')
    status.setAttribute('role', 'status')
    const actions = document.createElement('menu')
    actions.setAttribute('data-report', 'actions')
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
        preview.textContent = draft.markdown.get()
    })
    const close = (sent: boolean): void => {
        stop()
        dialog.close()
        dialog.remove()
        resolve(sent)
    }
    cancel.addEventListener('click', () => close(false))
    // Escape closes a modal dialog without a click.
    dialog.addEventListener('cancel', () => close(false))
    form.addEventListener('submit', (event) => {
        event.preventDefault()
        send.disabled = true
        status.textContent = 'Sending…'
        draft.send().then(
            () => close(true),
            (thrown: unknown) => {
                // 48.8 — the draft stands as it was, to be sent again.
                send.disabled = false
                status.textContent = `Not sent: ${isFailed(thrown) ? thrown.message : messageOf(thrown)}`
            },
        )
    })
    document.body.append(dialog)
    dialog.showModal()
    return promise
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
