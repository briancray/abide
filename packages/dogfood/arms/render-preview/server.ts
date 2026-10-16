const INVOICES: Record<
    string,
    {
        number: string
        customer: string
        due: string
        lines: { item: string; amount: string }[]
        total: string
    }
> = {
    '4021': {
        number: 'INV-4021',
        customer: 'Analytical Engines Ltd',
        due: '2026-10-14',
        lines: [
            { item: 'Annual license', amount: '$1,000.00' },
            { item: 'Onboarding', amount: '$240.00' },
        ],
        total: '$1,240.00',
    },
    '4022': {
        number: 'INV-4022',
        customer: 'Hopper & Co',
        due: '2026-10-21',
        lines: [
            { item: 'Seats × 12', amount: '$720.00' },
            { item: 'Priority support', amount: '$180.00' },
        ],
        total: '$900.00',
    },
}

// THE ESCAPING, BY HAND. Every value the document interpolates goes through
// it, and the one that is missed is markup a customer's name can inject.
function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

// A SECOND COPY OF THE INVOICE'S MARKUP: the app paints it one way and the
// preview writes it again here, and the two drift.
function documentOf(invoice: (typeof INVOICES)[string]): string {
    let rows = ''
    for (const line of invoice.lines)
        rows += `<tr><td>${escapeHtml(line.item)}</td><td>${escapeHtml(line.amount)}</td></tr>`
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 1.25rem; background: #fff; color: #1d2a28;
    font: 14px/1.5 system-ui, sans-serif">
<h1>Invoice ${escapeHtml(invoice.number)}</h1>
<p>${escapeHtml(invoice.customer)} · due ${escapeHtml(invoice.due)}</p>
<table>${rows}<tr><th>Total</th><th>${escapeHtml(invoice.total)}</th></tr></table>
</body></html>`
}

Bun.serve({
    routes: {
        '/api/previewInvoice': (request) => {
            const id = new URL(request.url).searchParams.get('id') ?? ''
            const invoice = INVOICES[id]
            if (invoice === undefined)
                return new Response('Not found', { status: 404 })
            return new Response(documentOf(invoice), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            })
        },
    },
})
