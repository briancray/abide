// 43.28 — THE DOM IS HAPPY-DOM'S AND THE WIRE IS BUN'S. A test under the preload builds requests and
// blobs for a server it runs in process, and happy-dom's own drop a `cookie` header a test sets and
// hand a handler a `Blob` with no `bytes()`. THE REVERT: drop the restore in `measure/preload.ts`;
// the cookie reads `null` and `bytes` is not a function.

import { expect, test } from 'bun:test'

test('the preload leaves bun its own fetch family — 43.28', async () => {
    const request = new Request('http://app.invalid/', {
        headers: { cookie: 'theme=dark' },
    })
    expect(request.headers.get('cookie')).toBe('theme=dark')
    expect(typeof new Blob(['csv']).bytes).toBe('function')
    // And the DOM is still there to render into.
    expect(document.createElement('p').tagName).toBe('P')
})

// 43.28 — AND ITS SOCKET AND ITS STREAMS: a test opens a socket to a server it runs in process, with
// the headers bun's `WebSocket` takes, and pipes a body through a `TransformStream`. THE REVERT: drop
// `WebSocket` from the restore and happy-dom's throws "The subprotocol '[object Object]' is invalid";
// drop `TransformStream` and `pipeThrough` throws "The transform's 'readable' property must be a
// ReadableStream" — happy-dom's is node's `Transform`.
test('the preload leaves bun its own WebSocket and web streams — 43.28', async () => {
    using server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (request, served) =>
            served.upgrade(request, { data: request.headers.get('x-tab') })
                ? undefined
                : new Response('not a socket', { status: 400 }),
        websocket: {
            data: undefined as unknown as string | null,
            message: (socket, message) => {
                socket.send(`${socket.data} ${message}`)
            },
        },
    })
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
        headers: { 'x-tab': 'one' },
    } as never)
    const echoed = await new Promise<string>((resolve, reject) => {
        socket.onopen = () => socket.send('hi')
        socket.onmessage = (event) => resolve(String(event.data))
        socket.onerror = () => reject(new Error('the socket did not open'))
    })
    socket.close()
    expect(echoed).toBe('one hi')
    const piped = new Response('streamed').body?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>(),
    )
    expect(await new Response(piped).text()).toBe('streamed')
})

// 43.35 — A PARSED DOCUMENT FETCHES NOTHING IT NAMES: a server-rendered page parsed in a test names
// its stylesheets and its script at an address nothing in the test answers. THE REVERT: register the
// DOM with `enableCSSFileLoading: true`; `asked` reads 2 — the two stylesheets.
//
// `waitUntilComplete` waits on EVERY task the process's one window holds, and under
// `bun run test:serial` every earlier file left its own there — a keyed value's `ttl` in
// `bareSelection.test.ts` arms a 60 s timer, and the wait outlived the test's 5 s. So what earlier
// files left is aborted first, and the wait is on this test's own. THE REVERT: drop the `abort`;
// `bun test packages/abide/tests/bareSelection.test.ts packages/harness/tests/preload.test.ts`
// times out.
test('a document parsed under the preload fetches no stylesheet or script it names — 43.35', async () => {
    const happyDOM = (
        window as unknown as {
            happyDOM: {
                abort(): Promise<void>
                waitUntilComplete(): Promise<void>
            }
        }
    ).happyDOM
    await happyDOM.abort()
    let asked = 0
    using server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => {
            asked += 1
            return new Response('', { headers: { 'content-type': 'text/css' } })
        },
    })
    const origin = `http://127.0.0.1:${server.port}`
    document.head.innerHTML = `<link rel="stylesheet" href="${origin}/entry.css"><script src="${origin}/entry.js"></script>`
    new DOMParser().parseFromString(
        `<html><head><link rel="stylesheet" href="${origin}/parsed.css"></head><body></body></html>`,
        'text/html',
    )
    await happyDOM.waitUntilComplete()
    document.head.innerHTML = ''
    expect(asked).toBe(0)
})

// 43.36 — A POPOVER OPENS AND CLOSES UNDER THE PRELOAD: happy-dom gives an element `popover` and no
// `showPopover`, so a component that opens one on mount threw before its test saw it render. THE
// REVERT: drop `installPopover()` from `measure/preload.ts`; `showPopover` is not a function.
test('the preload opens and closes a popover — 43.36', () => {
    const host = document.createElement('div')
    host.setAttribute('popover', 'manual')
    document.body.append(host)
    const toggles: string[] = []
    host.addEventListener('toggle', (event) =>
        toggles.push((event as Event & { newState: string }).newState),
    )
    host.showPopover()
    expect(host.matches(':popover-open')).toBe(true)
    host.showPopover()
    host.hidePopover()
    expect(host.matches(':popover-open')).toBe(false)
    expect(host.togglePopover()).toBe(true)
    expect(host.togglePopover(true)).toBe(true)
    expect(host.togglePopover(false)).toBe(false)
    expect(toggles).toEqual(['open', 'closed', 'open', 'closed'])
    // An element with no `popover` attribute is refused, as a browser refuses it.
    expect(() => document.createElement('p').showPopover()).toThrow()
    host.remove()
})

// 43.37 — A FILE A TEST BUILDS IS ONE THE DOM TAKES: a test picks files on an `<input type="file">`
// through a `DataTransfer`, and the component reads them with a `FileReader` or hands them to the
// wire. THE REVERT: drop `bridgeFiles()` from `measure/preload.ts`; `items.add` throws "parameter 1
// is not of type 'File'", and `files` reads 0 — the picked file never reached the input.
test('a File the globals build is one the DOM takes, and one the wire sends — 43.37', async () => {
    const picked = new File(['a,b\n1,2'], 'deals.csv', { type: 'text/csv' })
    let files = 0
    try {
        const transfer = new DataTransfer()
        transfer.items.add(picked)
        const input = document.createElement('input')
        input.type = 'file'
        input.files = transfer.files
        files = input.files.length
    } catch {}
    expect(`files: ${files}`).toBe('files: 1')
    const reader = new FileReader()
    const read = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result)
        reader.readAsText(picked)
    })
    expect(read).toBe('a,b\n1,2')
    // Still the runtime's: it has `bytes()`, and a `File` bun parsed off a body passes `instanceof`.
    expect(new TextDecoder().decode(await picked.bytes())).toBe('a,b\n1,2')
    const body = new FormData()
    body.append('upload', picked)
    const parsed = await new Request('http://app.invalid/', {
        method: 'POST',
        body,
    }).formData()
    expect(parsed.get('upload') instanceof File).toBe(true)
    expect((parsed.get('upload') as File).name).toBe('deals.csv')
})

// 43.38 — A FORM'S ENTRIES ARE ITS FIELDS: a submit handler reads `new FormData(form)`, and bun's
// `FormData` ignores the form it is handed. THE REVERT: drop `bridgeFiles()`; `keys` reads `[]`.
test('a FormData built from a form carries its fields and its files — 43.38', () => {
    const form = document.createElement('form')
    form.innerHTML =
        '<input name="name" value="Ada"><input type="file" name="avatar"><input type="file" name="none">'
    const transfer = new DataTransfer()
    try {
        transfer.items.add(new File(['png'], 'ada.png', { type: 'image/png' }))
    } catch {}
    ;(form.querySelector('[name=avatar]') as HTMLInputElement).files =
        transfer.files
    const entries = new FormData(form)
    expect([...entries.keys()]).toEqual(['name', 'avatar', 'none'])
    expect(entries.get('name')).toBe('Ada')
    expect((entries.get('avatar') as File).name).toBe('ada.png')
    // An empty file input is an empty file, as a browser sends it.
    expect((entries.get('none') as File).size).toBe(0)
})

// 43.39 — AN IFRAME'S PAGE IS NOT LOADED: a component embedding a video names a page at a host
// nothing in the test answers. happy-dom 21 loads none by default, through `enableIframePageLoading`,
// a default a release can flip — so the test flips it, and what has to hold the line is the
// preload's own `disableIframePageLoading`. THE REVERT: drop it from `measure/preload.ts`; `asked`
// reads 1. The wait is on this test's own tasks, for 43.35's reason above.
test('an iframe under the preload loads no page — 43.39', async () => {
    const happyDOM = (
        window as unknown as {
            happyDOM: {
                abort(): Promise<void>
                waitUntilComplete(): Promise<void>
                settings: { enableIframePageLoading: boolean }
            }
        }
    ).happyDOM
    await happyDOM.abort()
    happyDOM.settings.enableIframePageLoading = true
    using _restore = {
        [Symbol.dispose]() {
            happyDOM.settings.enableIframePageLoading = false
        },
    }
    let asked = 0
    using server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => {
            asked += 1
            return new Response('<p>embedded</p>', {
                headers: { 'content-type': 'text/html' },
            })
        },
    })
    const frame = document.createElement('iframe')
    frame.src = `http://127.0.0.1:${server.port}/embed`
    document.body.append(frame)
    await happyDOM.waitUntilComplete()
    frame.remove()
    expect(asked).toBe(0)
})
