import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

const titlesOf = (html: string) => html.match(/<title>[^<]*<\/title>/g)

test("a page's title replaces its layout's", async () => {
    await using app = await createApp()
    const list = await app.fetch(new Request('http://crm.invalid/companies'))
    expect(titlesOf(await list.text())).toEqual([
        '<title>Companies — CRM</title>',
    ])
    const company = await app.fetch(
        new Request('http://crm.invalid/companies/hopper-and-co'),
    )
    // One title, the page's: its name fills in when the company lands.
    expect(titlesOf(await company.text())).toEqual(['<title> — CRM</title>'])
})
