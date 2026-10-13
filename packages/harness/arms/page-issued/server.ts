const ISSUED: Record<string, string> = {
    '4021': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>INV-4021</title>
<style>
body { margin: 0; padding: 1.25rem; font: 14px/1.5 system-ui, sans-serif;
    color: #1d2a28; background: #fff; }
h1 { margin: 0; font-size: 1.25rem; }
p { margin: .25rem 0 1rem; color: #5b6b68; }
table { width: 100%; border-collapse: collapse; }
td, th { padding: .375rem 0; border-top: 1px solid #d9e0de; text-align: left; }
td + td, th + th { text-align: right; }
</style>
</head>
<body>
<h1>Invoice INV-4021</h1>
<p>Analytical Engines Ltd · issued 2026-09-14 · due 2026-10-14</p>
<table>
<tr><td>Annual license</td><td>$1,000.00</td></tr>
<tr><td>Onboarding</td><td>$240.00</td></tr>
<tr><th>Total</th><th>$1,240.00</th></tr>
</table>
</body>
</html>`,
}

Bun.serve({
    routes: {
        // THE DOCUMENT TYPE, BY HAND. Left off, a browser is handed text it
        // has to guess at, and `nosniff` tells it not to.
        '/api/issuedInvoice': (request) => {
            const id = new URL(request.url).searchParams.get('id') ?? ''
            const html = ISSUED[id]
            if (html === undefined)
                return new Response('Not found', { status: 404 })
            return new Response(html, {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            })
        },
    },
})
