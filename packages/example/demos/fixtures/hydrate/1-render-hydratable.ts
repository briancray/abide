import { renderToString } from 'abide/server'
import Page from '../server/2-suspend-and-stream.abide'

/**
 * `hydratable` is what puts the markers in — two comments bracketing every slot. Without them there is
 * nothing for a client to adopt, and it would have to build the page a second time.
 */
export async function render(): Promise<string> {
    return await renderToString(Page({}), { hydratable: true })
}
