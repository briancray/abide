import { GET, page, render } from '@abide/abide/server'
import { renderPreviewDatabase } from '#server/renderPreviewDatabase'
import Document from '#ui/components/RenderPreviewDocument.abide'

// The preview's own document: no bundle, and its styles inline.
const SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 1.25rem; background: #fff; color: #1d2a28;
    font: 14px/1.5 system-ui, sans-serif"></body></html>`

export const previewInvoice = GET(
    async ({ id }: { id: string }) => {
        const invoice = await renderPreviewDatabase.invoices.find(id)
        return page(await render(Document({ invoice }), SHELL))
    },
    { description: 'An invoice, rendered as a page of its own.' },
)
