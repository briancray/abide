// 48.3, 48.7-48.9 — A PROBLEM REPORT IN A BROWSER: the page's own lines and the server's for its
// trace, shown in abide's dialog word for word as they are sent, and a refused send leaving the draft
// standing. `fetch` answers from here and records each call.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { flushSync, log } from '#shared'
import { report, REPORTING } from '#shared/report.ts'
import { reportDialog } from '#ui/reportDialog.ts'

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const SERVER_LINE = {
    time: '2026-01-01T00:00:01.000Z',
    level: 'error',
    namespace: 'crm:billing',
    message: 'billing refused the key',
    trace: TRACE,
    span: undefined,
}

const unstubbedFetch = globalThis.fetch
// A file before this one in the worker may have filled the server's slots; a page has none.
const slots = { ...REPORTING }
const sent: { url: string; body: Record<string, unknown> }[] = []
let sendStatus = 200

beforeAll(() => {
    REPORTING.lines = undefined
    REPORTING.send = undefined
    REPORTING.context = undefined
    globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
        // A call's address is the page's, relative to it.
        const url = typeof input === 'string' ? input : input.url
        const method =
            init?.method ?? (typeof input === 'string' ? 'GET' : input.method)
        if (method === 'GET') return Response.json([SERVER_LINE])
        sent.push({
            url,
            body: JSON.parse(
                String(init?.body ?? (await (input as Request).text())),
            ),
        })
        return sendStatus === 200
            ? Response.json(null)
            : Response.json(
                  {
                      type: 'about:blank',
                      title: 'HttpError',
                      status: sendStatus,
                      detail: 'the report was not delivered',
                  },
                  {
                      status: sendStatus,
                      headers: { 'content-type': 'application/problem+json' },
                  },
              )
    }) as typeof fetch
})

afterAll(() => {
    globalThis.fetch = unstubbedFetch
    Object.assign(REPORTING, slots)
})

const settle = async (): Promise<void> => {
    await Bun.sleep(10)
    flushSync()
}

// THE REVERT: drop the server's lines from `linesFor` — the preview holds the page's line alone.
test('a draft holds the page’s lines and the server’s for its trace, and the dialog shows what is sent — 48.2, 48.4, 48.7, 48.9', async () => {
    log.warning('clicked sync')
    const draft = report({ trace: TRACE })
    const opened = reportDialog(draft)
    await settle()
    const dialog = document.querySelector(
        'dialog.abide-report',
    ) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    const summary = dialog.querySelector('input') as HTMLInputElement
    summary.value = 'Sync fails'
    summary.dispatchEvent(new Event('input'))
    await settle()
    const preview = dialog.querySelector('pre')?.textContent ?? ''
    expect(preview).toBe(draft.markdown())
    expect(preview).toContain('## Sync fails')
    expect(preview).toContain('clicked sync')
    expect(preview).toContain('billing refused the key')
    ;(dialog.querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    expect(sent).toHaveLength(1)
    const [{ url, body }] = sent as [
        { url: string; body: Record<string, unknown> },
    ]
    expect(new URL(url, 'http://page.test').pathname).toBe('/__abide/report')
    expect(body.summary).toBe('Sync fails')
    expect(body.traces).toEqual([TRACE])
    // The server adds its own lines back, so the page sends only its own.
    expect(
        (body.lines as { message: string }[]).map((line) => line.message),
    ).toContain('clicked sync')
    expect(
        (body.lines as { message: string }[]).map((line) => line.message),
    ).not.toContain('billing refused the key')
    expect(document.querySelector('dialog.abide-report')).toBeNull()
    expect(await opened).toBe(true)
})

// THE REVERT: close the dialog in the send's rejection too — the draft is gone with it.
test('a refused send leaves the dialog open on its draft, saying why, and Cancel closes it unsent — 48.8, 48.9', async () => {
    sendStatus = 502
    const draft = report()
    draft.summary.set('Still failing')
    const opened = reportDialog(draft)
    await settle()
    const dialog = document.querySelector(
        'dialog.abide-report',
    ) as HTMLDialogElement
    ;(dialog.querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    expect(dialog.isConnected).toBe(true)
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe(
        'Not sent: the report was not delivered',
    )
    expect((dialog.querySelector('input') as HTMLInputElement).value).toBe(
        'Still failing',
    )
    expect(
        (dialog.querySelector('button[type="submit"]') as HTMLButtonElement)
            .disabled,
    ).toBe(false)
    ;(
        dialog.querySelector('button[type="button"]') as HTMLButtonElement
    ).click()
    expect(await opened).toBe(false)
    expect(dialog.isConnected).toBe(false)
    sendStatus = 200
})
