import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { parseArgs } from '../src/lib/server/rpc/parseArgs.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { buildRpcRequest } from '../src/lib/shared/buildRpcRequest.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

const options = { logRequests: false }

// pass-through text schema — validation isn't the unit under test here.
const passthrough: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
}

// files schema requiring `photos` to be a non-empty File[] — the validation a
// real z.object({ photos: z.array(z.instanceof(File)) }) would perform.
const requirePhotos: StandardSchemaV1 = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => {
            const photos = (value as { photos?: unknown }).photos
            if (
                Array.isArray(photos) &&
                photos.length > 0 &&
                photos.every((f) => f instanceof File)
            ) {
                return { value: { photos } }
            }
            return { issues: [{ message: 'photos must be a non-empty list of files' }] }
        },
    },
}

function multipartRequest(form: FormData): Request {
    return new Request('https://test.local/rpc/createPost', { method: 'POST', body: form })
}

describe('multipart uploads', () => {
    test('parseArgs splits file parts out of args and groups repeated text fields', async () => {
        const form = new FormData()
        form.set('title', 'Hi')
        form.append('tags', 'x')
        form.append('tags', 'y')
        form.append('photos', new File(['a'], 'a.png', { type: 'image/png' }))
        const req = multipartRequest(form)
        await runWithRequestScope(req, options, async () => {
            // text fields become args (repeats → array); the binary is held off args
            expect(await parseArgs('POST', req)).toEqual({ title: 'Hi', tags: ['x', 'y'] })
            return new Response('ok')
        })
    })

    test('filesSchema validates the File parts and merges them into the handler args', async () => {
        let seen: { title?: string; photos?: File[] } | undefined
        const createPost = defineVerb(
            'POST',
            '/rpc/createPost',
            (args: { title: string; photos: File[] }) => {
                seen = args
                return json({ ok: true })
            },
            { inputSchema: passthrough, filesSchema: requirePhotos },
        )
        const form = new FormData()
        form.set('title', 'Hi')
        form.append('photos', new File(['a'], 'a.png'))
        form.append('photos', new File(['b'], 'b.png'))
        const req = multipartRequest(form)
        const res = await runWithRequestScope(req, options, () => createPost.fetch(req))
        expect(res.status).toBe(200)
        expect(seen?.title).toBe('Hi')
        expect(seen?.photos?.map((file) => file.name)).toEqual(['a.png', 'b.png'])
    })

    test('a filesSchema violation is a 422, like a bad text field', async () => {
        const createPost = defineVerb('POST', '/rpc/createPostStrict', () => json({ ok: true }), {
            inputSchema: passthrough,
            filesSchema: requirePhotos,
        })
        const form = new FormData()
        form.set('title', 'Hi') // no photos
        const req = multipartRequest(form)
        const res = await runWithRequestScope(req, options, () => createPost.fetch(req))
        expect(res.status).toBe(422)
    })

    test('a FormData built by the client emitter round-trips through the verb', async () => {
        let seen: { photos?: File[] } | undefined
        const createPost = defineVerb(
            'POST',
            '/rpc/createPostRoundtrip',
            (args: { photos: File[] }) => {
                seen = args
                return json({ ok: true })
            },
            { inputSchema: passthrough, filesSchema: requirePhotos },
        )
        const form = new FormData()
        form.set('title', 'Hi')
        form.append('photos', new File(['a'], 'a.png', { type: 'image/png' }))
        // the client emitter ships FormData as a multipart body (no hand-set content-type)
        const req = buildRpcRequest({
            method: 'POST',
            url: '/rpc/createPostRoundtrip',
            args: form,
            baseUrl: 'https://test.local/',
        })
        expect(req.headers.get('content-type')).toContain('multipart/form-data')
        const res = await runWithRequestScope(req, options, () => createPost.fetch(req))
        expect(res.status).toBe(200)
        expect(seen?.photos?.map((file) => file.name)).toEqual(['a.png'])
    })
})
