import { reactive } from '@abide/abide'

export type Activity = { id: number; contact: string; kind: string }

/** This tab's recent activity, newest last; anything importing it may add. */
export const activity = reactive<Activity[]>([
    { id: 1, contact: 'Ada Lovelace', kind: 'Email' },
    { id: 2, contact: 'Katherine Johnson', kind: 'Call' },
    { id: 3, contact: 'Ada Lovelace', kind: 'Meeting' },
])

/** Appends an entry and lets the oldest go past three. */
export function logActivity(contact: string, kind: string): void {
    activity.patch((entries) => {
        entries.push({ id: (entries.at(-1)?.id ?? 0) + 1, contact, kind })
        if (entries.length > 3) entries.shift()
    })
}
