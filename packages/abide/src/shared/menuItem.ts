// 38.88 — THE NATIVE APP'S MENU BAR IS THE ROUTE'S: a layout or a page calls `onMenu` in its
// `<script>`, and the window shows the menus filed while it stands. An item made by
// `menuItem` is one a page answers; the rest are an address or a role, which need no page.
//
// 38.213 — AND ITS KEY IS THE PAGE'S TOO, where no menu bar takes it: one declaration of the item
// is its menu entry in the native app and its shortcut in a browser. Not in the window, whose menu
// bar runs the item on the same key.

import { hotkeyBinding } from './hotkeyBinding.ts'
import { hotkeys } from './hotkeys.ts'
import { isServer } from './isServer.ts'
import { native } from './native.ts'
import { owned } from './reactive/watch.ts'

/** What the platform performs for a menu item, where an address or a page's own answer could not. 38.89. */
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
    | 'window'
    | 'update'

/** One entry in the native app's menu bar, or in a menu under it. */
export type MenuItem =
    | 'separator'
    | MenuEntry
    | {
          label: string
          /** The shortcut, modifiers first: `cmd+shift+k`. */
          key?: string
          role?: MenuRole
          /** An address in the app, navigated to when the item is picked. */
          href?: string
          items?: MenuItem[]
      }

/**
 * A menu item as the window builds it — what a page tells it (`reportMenu`) and the defaults it
 * stands beside. An item the page answers carries the `id` it is told by. `closeWindow` is no
 * `MenuRole` a page can name: it is the application menu's Quit where the Dock follows the window
 * (38.184), and only the default menu bar carries it.
 */
export type NativeMenuItem =
    | 'separator'
    | {
          label: string
          key?: string | undefined
          role?: MenuRole | 'closeWindow' | undefined
          id?: number | undefined
          items?: NativeMenuItem[] | undefined
      }

/** An item a page answers: each function `on` filed runs when it is picked. 38.91. */
export class MenuEntry {
    label: string
    key: string | undefined
    href: string | undefined
    private readonly answers = new Set<() => unknown>()
    /** 38.213 — the page's listener for `key`, while an answer is filed. */
    private listener: ((event: KeyboardEvent) => void) | undefined = undefined

    constructor(item: { label: string; key?: string; href?: string }) {
        this.label = item.label
        this.key = item.key
        this.href = item.href
    }

    /**
     * Files `answer` to run each time the item is picked, or its key pressed in a page with no menu
     * bar to take it; returns what unfiles it. 38.214 — filed in a component's setup, it is unfiled
     * as the component is disposed.
     */
    on(answer: () => unknown): () => void {
        this.answers.add(answer)
        this.listen()
        return owned(() => {
            this.answers.delete(answer)
            if (this.answers.size === 0) this.unlisten()
        })
    }

    // 38.213 — `cmd` is the menu bar's ⌘, which in a page is `mod`: Ctrl where there is no ⌘. A key
    // holding a modifier is the item's in a field too, as the menu bar's is; a bare one is the field's.
    private listen(): void {
        if (this.listener !== undefined || this.key === undefined) return
        if (isServer() || native() !== undefined) return
        const written = this.key.replace(/\b(?:cmd|command)\b/gi, 'mod')
        const { ctrl, meta, alt, mod } = hotkeyBinding(written)
        this.listener = hotkeys({
            [written]: {
                run: () => this.pick(),
                editable: ctrl || meta || alt || mod,
            },
        })
        addEventListener('keydown', this.listener)
    }

    private unlisten(): void {
        if (this.listener === undefined) return
        removeEventListener('keydown', this.listener)
        this.listener = undefined
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
