// 39.1, 39.6 — THE ROUTER'S LEVEL BEING MOUNTED, set by the router around a page's or a layout's
// setup and markup: a component mounted inside one adds its `<head>` to that level's
// (`contributeHead`), and one mounted later — a row a list grew by — finds none and leaves the
// document's head alone. `unapplied` is the head the components built on the client contributed
// while it was set, which the router applies once it is unset rather than once a component.
export const MOUNTING_LEVEL: {
    current:
        | {
              head: (() => string) | undefined
              /** Every component head joined to the level's own, in the order they mounted. */
              contributed: (() => string)[] | undefined
          }
        | undefined
    unapplied: string
} = {
    current: undefined,
    unapplied: '',
}
