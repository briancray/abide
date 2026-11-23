import { list } from './list.ts'

/** Why a notice left `toasts.list`, as its `onclose` is told. */
export type CloseReason = 'timeout' | 'dismissed' | 'action'

// 50.42 — each notice's `onclose`, by its id, until the notice leaves. Off the `Toast`, which is what
// `toasts.host` shows and an app reads, and a callback is neither.
export const CLOSERS = new Map<number, (reason: CloseReason) => void>()

/** Takes a notice down before its timeout; a notice already gone leaves the list as it is (50.15). */
export function dismiss(id: number): void {
    close(id, 'dismissed')
}

/** Takes the notice holding `id` out of `toasts.list`, and tells its `onclose` why (50.42). */
export function close(id: number, reason: CloseReason): void {
    const at = list.peek()?.findIndex((toast) => toast.id === id) ?? -1
    if (at === -1) return
    list.patch((held) => {
        held.splice(at, 1)
    })
    const onclose = CLOSERS.get(id)
    if (onclose === undefined) return
    CLOSERS.delete(id)
    onclose(reason)
}
