// Types and values a `.abide` file IMPORTS, which is the case a single-file reader cannot cover.
//
// Nothing here is exercised at runtime. It exists so the type fixtures beside it have a real module
// boundary to cross: an imported interface, an imported generic, an imported union and an imported
// value, each used inside a template expression where the checker has to resolve it the same way it
// would in an ordinary `.ts` file.

export interface Book {
    title: string
    pages: number
    author: { name: string }
}

export type Shelf = 'fiction' | 'reference'

export interface Paged<T> {
    items: T[]
    total: number
}

export function shelve<T>(items: T[]): Paged<T> {
    return { items, total: items.length }
}

export const FIRST: Book = { title: 'anathem', pages: 981, author: { name: 'stephenson' } }
