import { navigate } from 'abide'

/**
 * The two options a move takes, and both are about what the BROWSER does rather than what renders.
 *
 * `replace` swaps the current history entry instead of pushing one, which is what a redirect after a
 * form, a filter that rewrites its own query, and a wizard step all want: the back button should reach
 * where the reader came FROM, not the state they just left.
 *
 * `keepScroll` leaves the offset alone. The default is to reset it, because a new page read from the
 * middle is the wrong thing far more often — so this is for the moves that are not really a new page,
 * which in practice is the same-route kind that republishes rather than remounting.
 */
export async function applyFilter(tab: string): Promise<void> {
    await navigate(`?tab=${tab}`, { replace: true, keepScroll: true })
}
