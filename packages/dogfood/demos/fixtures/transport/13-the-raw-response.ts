import { user } from './1-a-get-is-a-keyed-memo.ts'

/**
 * The same call handed back as the RESPONSE instead of a decoded value — for the cases where the
 * envelope is the point: a header to read, a status to branch on, a body to hand somewhere else whole.
 *
 * It is a hatch and not a second API: `user.raw({ id })` and `user({ id })` reach the same handler by
 * the same address, and the second is what a component should read. Nothing about the raw form is
 * memoised, because a `Response` body can be consumed once.
 *
 * `method` and `description` are what the DECLARATION said, readable off the handle — which is what
 * lets a generated surface describe an endpoint without a parallel manifest to keep in step.
 */
export async function statusOf(id: number): Promise<number> {
    const answered = await user.raw({ id })
    return answered.status
}

export const how: string = `${user.method} — ${user.description ?? 'no description'}`
