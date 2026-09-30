/**
 * A queue one side pushes into and one reader drains as an async iterator, ending when closed.
 *
 * The relay's shape: whatever arrives from the bridge is pushed as it lands, and the turn reading it
 * waits only where nothing has.
 */
export class Inbox<Item> implements AsyncIterable<Item> {
    #items: Item[] = []
    #closed = false
    #wake: (() => void) | undefined = undefined

    push(item: Item): void {
        if (this.#closed) return
        this.#items.push(item)
        this.#wake?.()
    }

    close(): void {
        this.#closed = true
        this.#wake?.()
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<Item> {
        for (;;) {
            if (this.#items.length > 0) {
                yield this.#items.shift() as Item
                continue
            }
            if (this.#closed) return
            await new Promise<void>((done) => {
                this.#wake = done
            })
            this.#wake = undefined
        }
    }
}
