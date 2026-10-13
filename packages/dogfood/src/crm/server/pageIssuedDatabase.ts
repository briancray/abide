// The app data this example stands on.

// THE COPY THE CUSTOMER WAS SENT, stored at issue so a later template change
// cannot rewrite what was billed — its styles inline on each element, as an
// email's are, since the app's CSP refuses a `<style>` block (29.5) and a
// stylesheet the app serves is a template that could change under it.
const ISSUED: Record<string, string> = {
    '4021': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>INV-4021</title>
</head>
<body style="margin: 0; padding: 1.25rem; font: 14px/1.5 system-ui, sans-serif;
    color: #1d2a28; background: #fff">
<h1 style="margin: 0; font-size: 1.25rem">Invoice INV-4021</h1>
<p style="margin: .25rem 0 1rem; color: #5b6b68">
Analytical Engines Ltd · issued 2026-09-14 · due 2026-10-14</p>
<table style="width: 100%; border-collapse: collapse">
<tr><td style="padding: .375rem 0; border-top: 1px solid #d9e0de">Annual licence</td>
<td style="padding: .375rem 0; border-top: 1px solid #d9e0de; text-align: right">$1,000.00</td></tr>
<tr><td style="padding: .375rem 0; border-top: 1px solid #d9e0de">Onboarding</td>
<td style="padding: .375rem 0; border-top: 1px solid #d9e0de; text-align: right">$240.00</td></tr>
<tr><th style="padding: .375rem 0; border-top: 1px solid #d9e0de; text-align: left">Total</th>
<th style="padding: .375rem 0; border-top: 1px solid #d9e0de; text-align: right">$1,240.00</th></tr>
</table>
</body>
</html>`,
}

/** A slow database, so the wait is on screen. */
export const pageIssuedDatabase = {
    invoices: {
        async issuedCopy(id: string): Promise<string> {
            await Bun.sleep(300)
            const html = ISSUED[id]
            if (html === undefined) throw new Error(`no invoice ${id}`)
            return html
        },
    },
}
