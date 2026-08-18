import { GET, page, render } from 'abide/server'
import Report from '#shared/demos/fixtures/Report.abide'

/**
 * The same walk, in the document the app's own pages are served in.
 *
 * `shell: true` is `app.html` — this app's `lang`, its viewport, its title — with the two things only
 * abide can add to it: the stylesheets the build wrote, and every scoped `<style>` block, both at the
 * end of the head. The render goes in the `<slot></slot>`, which is the same hole a page renders into,
 * so what comes back here IS what `abide start` would serve if this were a page.
 *
 * Nothing boots in it. `hydrate` is the second decision and it is off, so the client lane is left out
 * — deliberately, because the client mounts the PAGES route table at the outlet, and this path is not
 * in it: a lane here would render that table's answer over the report. A route whose URL really is a
 * page asks for both.
 */
export const served = GET(() => page(render(Report(), { shell: true })))
