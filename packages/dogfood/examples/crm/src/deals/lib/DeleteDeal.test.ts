import { expect, test } from 'bun:test'

import { flushSync, prompts } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import DeleteDeal from './DeleteDeal.abide'
import RenameDeal from './RenameDeal.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const deals = () =>
    [...document.querySelectorAll('li strong')].map((deal) => deal.textContent)

// Presses Delete on the first deal, then the dialog's button `part`.
async function answer(part: 'confirm' | 'cancel') {
    document.querySelector<HTMLButtonElement>('li button')?.click()
    await settled()
    flushSync()
    expect(dialog().open).toBe(true)
    dialog().querySelector<HTMLButtonElement>(`[data-prompts=${part}]`)?.click()
    await settled()
    flushSync()
}

test('a deal is deleted only once the dialog is confirmed', async () => {
    using _deals = await mount(DeleteDeal({}))
    await answer('cancel')
    expect(dialog().open).toBe(false)
    expect(deals()).toEqual(['Engine renewal', 'Compiler pilot'])
    await answer('confirm')
    expect(deals()).toEqual(['Compiler pilot'])
})

test('the question names the deal and is marked danger', async () => {
    using _deals = await mount(DeleteDeal({}))
    document.querySelector<HTMLButtonElement>('li button')?.click()
    await settled()
    flushSync()
    expect(dialog().getAttribute('role')).toBe('alertdialog')
    expect(dialog().hasAttribute('data-danger')).toBe(true)
    expect(dialog().querySelector('[data-prompts=title]')?.textContent).toBe(
        'Delete Engine renewal?',
    )
    dialog().querySelector<HTMLButtonElement>('[data-prompts=cancel]')?.click()
    await settled()
})

// THE REVERT: drop the `typedRight` check, and Delete enables at once.
test('Delete waits for the word to be typed', async () => {
    using _deals = await mount(DeleteDeal({}))
    const asked = prompts.confirm({ body: 'Delete Acme?', mustType: 'acme' })
    flushSync()
    const confirm = () =>
        dialog().querySelector('[data-prompts=confirm]') as HTMLButtonElement
    const input = dialog().querySelector(
        '[data-prompts=input]',
    ) as HTMLInputElement
    expect(confirm().disabled).toBe(true)
    input.value = ' ACME '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(confirm().disabled).toBe(false)
    confirm().click()
    expect(await asked).toBe(true)
})

test('Escape declines the question', async () => {
    using _deals = await mount(DeleteDeal({}))
    const asked = prompts.confirm('Delete Acme?')
    flushSync()
    const escape = new Event('cancel', { cancelable: true })
    if (dialog().dispatchEvent(escape)) dialog().close()
    expect(await asked).toBe(false)
    flushSync()
    expect(dialog().open).toBe(false)
})

// 50.43 — A PROMPT WITHDRAWN IS DECLINED, waiting or showing, and the next one shows in its place.
// THE REVERT: drop the `abort` listener in `queued` — the withdrawn prompt never settles, and
// `withdrawn: pending` where `false` is due.
test('a withdrawn prompt is declined, and the next shows in its place', async () => {
    using _deals = await mount(DeleteDeal({}))
    const leaving = new AbortController()
    let withdrawn: boolean | 'pending' = 'pending'
    void prompts
        .confirm({ body: 'Keep editing?', signal: leaving.signal })
        .then((answer) => {
            withdrawn = answer
        })
    const next = prompts.confirm('Archive Compiler pilot?')
    flushSync()
    expect(dialog().querySelector('[data-prompts=body]')?.textContent).toBe(
        'Keep editing?',
    )
    leaving.abort()
    await settled()
    flushSync()
    expect(`withdrawn: ${withdrawn}`).toBe('withdrawn: false')
    expect(dialog().open).toBe(true)
    expect(dialog().querySelector('[data-prompts=body]')?.textContent).toBe(
        'Archive Compiler pilot?',
    )
    dialog().querySelector<HTMLButtonElement>('[data-prompts=confirm]')?.click()
    expect(await next).toBe(true)
    expect(
        await prompts.confirm({ body: 'Gone?', signal: AbortSignal.abort() }),
    ).toBe(false)
})

// 50.45 — A CONFIRM THAT IS A CALL stays up while the call runs, shows what it failed with, and
// closes once it lands. THE REVERT: drop `onsubmit: submitted` from `prompts.host`'s `form` part —
// the dialog closes on the first press, `open: false` where `true` is due.
test('a confirm that is a call stays up, busy, until it lands, and shows why it failed', async () => {
    using _deals = await mount(DeleteDeal({}))
    let attempts = 0
    let release: () => void = () => {}
    const answered = prompts.confirm({
        body: 'Delete Engine renewal?',
        run: () => {
            attempts += 1
            if (attempts === 1)
                return Promise.reject(new Error('The deal is locked.'))
            return new Promise<void>((resolve) => {
                release = resolve
            })
        },
    })
    flushSync()
    const confirm = () =>
        dialog().querySelector<HTMLButtonElement>('[data-prompts=confirm]')
    confirm()?.click()
    await settled()
    flushSync()
    expect(`open: ${dialog().open}`).toBe('open: true')
    expect(dialog().querySelector('[data-prompts=error]')?.textContent).toBe(
        'The deal is locked.',
    )
    confirm()?.click()
    flushSync()
    expect(dialog().hasAttribute('data-busy')).toBe(true)
    expect(confirm()?.disabled).toBe(true)
    release()
    expect(await answered).toBe(true)
    await settled()
    flushSync()
    expect(dialog().open).toBe(false)
    expect(dialog().hasAttribute('data-busy')).toBe(false)
})

// 50.44 — `modal: false` opens with `show`, leaving the page usable. THE REVERT: call `showModal`
// whatever `modal` says in `dialog` — `showModal` where `show` is due.
test('a prompt that is not modal opens beside the page', async () => {
    using _deals = await mount(DeleteDeal({}))
    const opened: string[] = []
    const { show, showModal } = HTMLDialogElement.prototype
    HTMLDialogElement.prototype.show = function () {
        opened.push('show')
        show.call(this)
    }
    HTMLDialogElement.prototype.showModal = function () {
        opened.push('showModal')
        showModal.call(this)
    }
    try {
        const answered = prompts.alert({
            body: 'Saved as draft.',
            modal: false,
        })
        flushSync()
        expect(opened).toEqual(['show'])
        dialog()
            .querySelector<HTMLButtonElement>('[data-prompts=confirm]')
            ?.click()
        await answered
    } finally {
        HTMLDialogElement.prototype.show = show
        HTMLDialogElement.prototype.showModal = showModal
    }
})

// 50.36 — TWO `Prompts` STANDING SHOW ONE DIALOG: the last mounted shows the queue, and the other shows
// nothing rather than a second modal over the first. THE REVERT: have `prompts.host` show the queue
// whether or not it is the last standing, and two dialogs open on one question.
test('a question shows in one dialog where two Prompts stand', async () => {
    using _deals = await mount(DeleteDeal({}))
    using _rename = await mount(RenameDeal({}))
    const asked = prompts.confirm('Delete Acme?')
    flushSync()
    const open = [...document.querySelectorAll('dialog')].filter(
        (each) => each.open,
    )
    expect(open).toHaveLength(1)
    open[0]?.querySelector<HTMLButtonElement>('[data-prompts=cancel]')?.click()
    expect(await asked).toBe(false)
})

// THE REVERT: have `prompts.alert` settle only where its button closed it — `queued(...).then((answer)
// => answer === undefined ? new Promise(() => {}) : undefined)` — and the alert Escape closed reads
// `escape: pending` where `escape: settled` is due.
test('an alert settles however it closes — 50.9', async () => {
    using _deals = await mount(DeleteDeal({}))
    const closed = async (close: () => void) => {
        let state = 'pending'
        void prompts.alert('Saved.').then(() => {
            state = 'settled'
        })
        flushSync()
        expect(dialog().open).toBe(true)
        close()
        await settled()
        flushSync()
        return state
    }
    const pressed = await closed(() =>
        dialog()
            .querySelector<HTMLButtonElement>('[data-prompts=confirm]')
            ?.click(),
    )
    const escaped = await closed(() => {
        if (dialog().dispatchEvent(new Event('cancel', { cancelable: true })))
            dialog().close()
    })
    expect([`button: ${pressed}`, `escape: ${escaped}`]).toEqual([
        'button: settled',
        'escape: settled',
    ])
})
