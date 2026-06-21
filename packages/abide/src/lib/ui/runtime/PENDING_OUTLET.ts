/* The outlet boundary the most recent `outlet()` call established (a layout's `<slot/>`
   fill point, or the router's root boundary in `#app`). The router reads it right after
   building/claiming a layer — synchronously, so it is exactly that layer's single slot —
   to learn where the NEXT chain layer mounts, without scanning the DOM. A layer with no
   slot (the leaf page) leaves it whatever the router reset it to. */
export const PENDING_OUTLET: { current: { open: Comment; close: Comment } | undefined } = {
    current: undefined,
}
