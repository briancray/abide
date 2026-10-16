import { expect, test } from 'bun:test'
import { principal } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { asMember } from './signedIn.ts'

test('the cookie holds an id, and the request reads the member', async () => {
    await using app = await createApp()
    const request = await asMember(app, 'theo@crm.example')

    // The seal is a JWT; its payload is the id, and the times abide adds.
    const sealed = request.headers.get('cookie') ?? ''
    const payload = JSON.parse(
        Buffer.from(sealed.split('.')[1] ?? '', 'base64url').toString(),
    )
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id'])

    const member = await app.run(async () => await principal.resolved, {
        request,
    })
    expect(member.name).toBe('Theo Park')
    expect(member.role).toBe('sales')
})
