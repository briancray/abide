// ONE PAGE, AS THE APP RENDERS IT. The markdown under `content/` is the source and this is what
// it compiles to: `scripts/buildPages.ts` writes one `CONTENT.ts` per page holding exactly this,
// and the generated `page.abide` beside it is the only reader. In #shared because the generator
// writes it and the ui reads it, which is the two sides the seam is for.
//
// EVERY FIELD IS HTML AND EVERY FIELD IS STATIC, and the second half is load-bearing. A `{raw}`
// slot over a value the compiler classes as a READ becomes a live text binding on the client —
// `escapeless` writes through `data`, which is not a parse — so a page whose body arrived as a
// PROP hydrated by replacing its own markup with the source of it. Read straight off a module
// constant, the slot is static: the server's markup stands and the client never touches it.
//
// SO THE PAGE IS DATA AND THE TEMPLATE IS THE SAME ON ALL EIGHTY-FIVE. What differs between two
// pages is this record, which is why the record is the import.

export type DocsContent = {
    // The content path, which is also the page's address: `values/index` answers at `/values`.
    slug: string
    // The page's opening — the stub notice where there is one, the title, the intent.
    header: string
    // The rendered body, the one value a page is mostly made of.
    body: string
    // The previous and next links, in reading order.
    footer: string
    // The heading list and the two downloads, as the rail renders them.
    rail: string
}
