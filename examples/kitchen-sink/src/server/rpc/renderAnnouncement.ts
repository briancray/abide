import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { render } from '@abide/abide/server/render'

/*
Renders the /emails/announcement page to a complete HTML string — the body you
would hand to an email sender — through the same in-process pipeline (app.html
shell, layout chain, params, inline rpc reads) an HTTP GET of that URL runs.
Called inside this handler's request scope, render() forwards the caller's
allowlisted auth/identity headers onto the page, exactly like an in-process rpc
read. The same page stays directly linkable at /emails/announcement.
*/
export const renderAnnouncement = GET(async () => {
    const html = await render('/emails/announcement')
    return json({ bytes: html.length, html })
})
