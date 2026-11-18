import { list } from './list.ts'

/** Takes a notice down before its timeout; a notice already gone leaves the list as it is (50.15). */
export function dismiss(id: number): void {
    const at = list.peek()?.findIndex((toast) => toast.id === id) ?? -1
    if (at === -1) return
    list.patch((held) => {
        held.splice(at, 1)
    })
}
