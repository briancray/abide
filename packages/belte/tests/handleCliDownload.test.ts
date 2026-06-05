import { describe, expect, test } from 'bun:test'
import { handleCliDownload } from '../src/lib/server/cli/handleCliDownload.ts'

/*
The platform segment is URL-supplied and flows into filesystem paths and a lazy
cross-compile, so an unknown/traversal value must be rejected up front — before
any FS access or build — rather than treated as a buildable target.
*/
describe('handleCliDownload platform allow-list', () => {
    const request = new Request('https://test.local/__belte/cli/x')

    test('rejects an unknown platform with 404', async () => {
        const response = await handleCliDownload(request, 'bogus-platform', 'app', process.cwd())
        expect(response.status).toBe(404)
    })

    test('rejects a traversal-shaped platform with 404', async () => {
        const response = await handleCliDownload(request, '../../etc/passwd', 'app', process.cwd())
        expect(response.status).toBe(404)
    })
})
