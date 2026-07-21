// TODO #8 — multipart file uploads. A mutation RPC accepts a `FormData` body: the router detects a
// `multipart/form-data` request, parses it, and passes the `FormData` to the handler as its single
// positional argument (a `File` rides in the FormData, never in a JSON args object). Covers the
// end-to-end upload, the CSRF gate for multipart, `files` schema validation, and maxBodySize.

import { describe, expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { POST } from './POST.ts'

// A handler typed to receive FormData. It pulls a text field + an uploaded file back out. `POST`
// infers Args = FormData from the parameter, so no cast is needed.
const uploadHandler = POST(async (form: FormData) => {
    const field = String(form.get('caption'))
    const file = form.get('avatar')
    if (!(file instanceof File)) throw new Error('expected an avatar file')
    return { field, name: file.name, content: await file.text(), size: file.size }
})

describe('multipart RPC upload (TODO #8)', () => {
    test('handler receives the FormData: text field + uploaded file', async () => {
        const app = createTestApp({ routes: { upload: uploadHandler } })
        try {
            const form = new FormData()
            form.set('caption', 'hello world')
            form.set('avatar', new File(['file-bytes-here'], 'pic.txt', { type: 'text/plain' }))

            const uploadRpc = app.rpc.upload
            if (uploadRpc === undefined) throw new Error('expected upload rpc')
            const result = (await uploadRpc(form)) as {
                field: string
                name: string
                content: string
                size: number
            }
            expect(result.field).toBe('hello world')
            expect(result.name).toBe('pic.txt')
            expect(result.content).toBe('file-bytes-here')
            expect(result.size).toBe('file-bytes-here'.length)
        } finally {
            await app.stop()
        }
    })

    test('a plain Blob is received as a File on the server', async () => {
        const app = createTestApp({ routes: { upload: uploadHandler } })
        try {
            const form = new FormData()
            form.set('caption', 'blob')
            form.set('avatar', new Blob(['abc'], { type: 'text/plain' }))
            const uploadRpc = app.rpc.upload
            if (uploadRpc === undefined) throw new Error('expected upload rpc')
            const result = (await uploadRpc(form)) as { content: string; size: number }
            expect(result.content).toBe('abc')
            expect(result.size).toBe(3)
        } finally {
            await app.stop()
        }
    })

    describe('CSRF gate for multipart', () => {
        test('multipart mutation WITHOUT x-abide is rejected 403', async () => {
            const app = createTestApp({ routes: { upload: uploadHandler } })
            try {
                const form = new FormData()
                form.set('caption', 'x')
                form.set('avatar', new File(['y'], 'y.txt'))
                // Raw fetch, no x-abide header — a cross-site <form> can send multipart but cannot set it.
                const response = await app.fetch('/rpc/upload', { method: 'POST', body: form })
                expect(response.status).toBe(403)
            } finally {
                await app.stop()
            }
        })

        test('multipart mutation WITH x-abide is admitted (200)', async () => {
            const app = createTestApp({ routes: { upload: uploadHandler } })
            try {
                const form = new FormData()
                form.set('caption', 'x')
                form.set('avatar', new File(['y'], 'y.txt'))
                const response = await app.fetch('/rpc/upload', {
                    method: 'POST',
                    headers: { 'x-abide': '1' },
                    body: form,
                })
                expect(response.status).toBe(200)
            } finally {
                await app.stop()
            }
        })
    })

    describe('files schema validation', () => {
        const guardedUpload = POST(
            async (form: FormData) => ({ ok: form.get('avatar') instanceof File }),
            {
                schemas: {
                    files: {
                        required: ['avatar'],
                        properties: { avatar: { accept: 'text/*', maxSize: 1024 } },
                    },
                },
            },
        )

        test('missing a required file field → 422 validation error', async () => {
            const app = createTestApp({ routes: { upload: guardedUpload } })
            try {
                const form = new FormData()
                form.set('caption', 'no file attached')
                const response = await app.fetch('/rpc/upload', {
                    method: 'POST',
                    headers: { 'x-abide': '1' },
                    body: form,
                })
                expect(response.status).toBe(422)
                const body = (await response.json()) as {
                    kind: string
                    data: { fields: Record<string, string> }
                }
                expect(body.kind).toBe('ValidationError')
                expect(body.data.fields.avatar).toContain('Missing required file')
            } finally {
                await app.stop()
            }
        })

        test('required file present + within constraints → 200', async () => {
            const app = createTestApp({ routes: { upload: guardedUpload } })
            try {
                const form = new FormData()
                form.set('avatar', new File(['small'], 'a.txt', { type: 'text/plain' }))
                const uploadRpc = app.rpc.upload
                if (uploadRpc === undefined) throw new Error('expected upload rpc')
                const result = (await uploadRpc(form)) as { ok: boolean }
                expect(result.ok).toBe(true)
            } finally {
                await app.stop()
            }
        })

        test('wrong MIME type → 422 (accept constraint)', async () => {
            const app = createTestApp({ routes: { upload: guardedUpload } })
            try {
                const form = new FormData()
                form.set('avatar', new File(['<svg>'], 'a.svg', { type: 'image/svg+xml' }))
                const response = await app.fetch('/rpc/upload', {
                    method: 'POST',
                    headers: { 'x-abide': '1' },
                    body: form,
                })
                expect(response.status).toBe(422)
            } finally {
                await app.stop()
            }
        })
    })

    describe('text field validation (input schema, TODO #8 follow-up)', () => {
        // `avatar` is a FILE field (governed by `files`); `caption` + `count` are TEXT fields governed by
        // the JSON `input` schema. The handler still receives the raw FormData (validation is a gate only).
        const captioned = POST(
            async (form: FormData) => ({
                caption: String(form.get('caption')),
                count: form.get('count'),
            }),
            {
                schemas: {
                    input: {
                        type: 'object',
                        properties: { caption: { type: 'string' }, count: { type: 'number' } },
                        required: ['caption'],
                    },
                    files: { required: ['avatar'] },
                },
            },
        )

        test('missing a required TEXT field → 422 (input schema)', async () => {
            const app = createTestApp({ routes: { upload: captioned } })
            try {
                const form = new FormData()
                form.set('avatar', new File(['y'], 'y.txt')) // file present, but no `caption` text field
                const response = await app.fetch('/rpc/upload', {
                    method: 'POST',
                    headers: { 'x-abide': '1' },
                    body: form,
                })
                expect(response.status).toBe(422)
                const body = (await response.json()) as {
                    kind: string
                    data: { fields: Record<string, string> }
                }
                expect(body.kind).toBe('ValidationError')
                expect(body.data.fields.caption).toBeDefined()
            } finally {
                await app.stop()
            }
        })

        test('valid text + file → 200 (handler still receives raw FormData)', async () => {
            const app = createTestApp({ routes: { upload: captioned } })
            try {
                const form = new FormData()
                form.set('caption', 'a picture')
                form.set('count', '3')
                form.set('avatar', new File(['y'], 'y.txt'))
                const uploadRpc = app.rpc.upload
                if (uploadRpc === undefined) throw new Error('expected upload rpc')
                const result = (await uploadRpc(form)) as { caption: string; count: unknown }
                expect(result.caption).toBe('a picture')
                expect(result.count).toBe('3') // raw FormData string — validation is a gate, not a transform
            } finally {
                await app.stop()
            }
        })

        test('a coercible number-string passes, a non-number 422s (declared {type:number})', async () => {
            const app = createTestApp({ routes: { upload: captioned } })
            try {
                const ok = new FormData()
                ok.set('caption', 'c')
                ok.set('count', '42')
                ok.set('avatar', new File(['y'], 'y.txt'))
                expect(
                    (
                        await app.fetch('/rpc/upload', {
                            method: 'POST',
                            headers: { 'x-abide': '1' },
                            body: ok,
                        })
                    ).status,
                ).toBe(200)

                const bad = new FormData()
                bad.set('caption', 'c')
                bad.set('count', 'not-a-number')
                bad.set('avatar', new File(['y'], 'y.txt'))
                expect(
                    (
                        await app.fetch('/rpc/upload', {
                            method: 'POST',
                            headers: { 'x-abide': '1' },
                            body: bad,
                        })
                    ).status,
                ).toBe(422)
            } finally {
                await app.stop()
            }
        })

        test('the file field appearing in FormData does not fail input validation', async () => {
            // `projectFormText` excludes File entries, so `avatar` never reaches the input schema.
            const app = createTestApp({ routes: { upload: captioned } })
            try {
                const form = new FormData()
                form.set('caption', 'c')
                form.set('avatar', new File(['y'], 'y.txt'))
                const response = await app.fetch('/rpc/upload', {
                    method: 'POST',
                    headers: { 'x-abide': '1' },
                    body: form,
                })
                expect(response.status).toBe(200)
            } finally {
                await app.stop()
            }
        })
    })

    test('maxBodySize rejects an oversize multipart body (413)', async () => {
        const bounded = POST(
            async (form: FormData) => ({ got: form.get('avatar') instanceof File }),
            { maxBodySize: 32 },
        )
        const app = createTestApp({ routes: { upload: bounded } })
        try {
            const form = new FormData()
            form.set('avatar', new File(['x'.repeat(500)], 'big.txt', { type: 'text/plain' }))
            // Serialize the FormData to a Blob so fetch sends a concrete Content-Length the guard reads.
            const serialized = await new Response(form).blob()
            const response = await app.fetch('/rpc/upload', {
                method: 'POST',
                headers: { 'x-abide': '1', 'content-type': serialized.type },
                body: serialized,
            })
            expect(response.status).toBe(413)
        } finally {
            await app.stop()
        }
    })

    test('existing JSON mutations are unaffected (back-compat)', async () => {
        const echo = POST(async (args: { value: number }) => ({ doubled: args.value * 2 }))
        const app = createTestApp({ routes: { echo } })
        try {
            const echoRpc = app.rpc.echo
            if (echoRpc === undefined) throw new Error('expected echo rpc')
            const result = (await echoRpc({ value: 21 })) as { doubled: number }
            expect(result.doubled).toBe(42)
        } finally {
            await app.stop()
        }
    })
})
