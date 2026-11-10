/** One line of a docs page's rail: a heading the page writes, and the anchor it links to. */
export type Heading = { id: string; title: string; level: number }

// The rail every docs page shares: `Section` files its heading, a reference page files its own,
// and `Doc` lists them.
declare module '@abide/abide' {
    interface Shared {
        docHeadings: Heading[]
    }
}
