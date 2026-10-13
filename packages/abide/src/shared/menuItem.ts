// 38.88 — THE DESKTOP APP'S MENU BAR IS THE ROUTE'S: a layout or a page exports `menu` from its
// `<script module>`, and the window shows what the route it stands on exports. An item made by
// `menuItem` is one a page answers; the rest are an address or a role, which need no page.

/** What a menu item does natively, where an address or a page's own answer could not. 38.89. */
export type MenuRole =
    | 'about'
    | 'hide'
    | 'hideOthers'
    | 'showAll'
    | 'quit'
    | 'connect'
    | 'disconnect'
    | 'close'
    | 'undo'
    | 'redo'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'selectAll'
    | 'reload'
    | 'fullscreen'
    | 'minimize'
    | 'zoom'
    | 'front'

/** One entry in the desktop app's menu bar, or in a menu under it. */
export type MenuItem =
    | 'separator'
    | {
          label: string
          /** The shortcut, modifiers first: `cmd+shift+k`. */
          key?: string
          role?: MenuRole
          /** An address in the app, navigated to when the item is picked. */
          href?: string
          items?: MenuItem[]
      }

/** An item a page answers: each function `on` filed runs when it is picked. 38.91. */
export class MenuEntry {
    label: string
    key: string | undefined
    href: string | undefined
    private readonly answers = new Set<() => unknown>()

    constructor(item: { label: string; key?: string; href?: string }) {
        this.label = item.label
        this.key = item.key
        this.href = item.href
    }

    /** Files `answer` to run each time the item is picked; returns what unfiles it. */
    on(answer: () => unknown): () => void {
        this.answers.add(answer)
        return () => {
            this.answers.delete(answer)
        }
    }

    /** Runs every answer filed, a throw from one reported without stopping the rest. */
    pick(): void {
        for (const answer of [...this.answers])
            try {
                const answered = answer()
                if (answered instanceof Promise) answered.catch(reportError)
            } catch (thrown) {
                reportError(thrown)
            }
    }
}

/** A menu item a page answers with `on`. */
export function menuItem(item: {
    label: string
    key?: string
    href?: string
}): MenuEntry {
    return new MenuEntry(item)
}
