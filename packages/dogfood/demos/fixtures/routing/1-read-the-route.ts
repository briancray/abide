import { route } from 'abide'

/** The PATTERN that matched, not the path — `/users/[id]` for every `/users/42`. */
export function pattern(): string {
    return route().name
}

/** A segment. An absent optional segment is OMITTED rather than present-and-empty. */
export function currentUser(): string | undefined {
    return route().params.id
}
