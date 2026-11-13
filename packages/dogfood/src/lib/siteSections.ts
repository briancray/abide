// WHICH ADDRESSES ARE THE SITE. The docs' own pages and the rulebook get the bar and the sidebar; a
// page of the CRM, mounted at the address the CRM serves it at so an example's requests reach it, is
// that app rather than the site and is served with none of the site around it (40.37).

import { isSitePage } from './sitePages.ts'

/** Whether `pathname` is a page of the CRM: neither a docs page nor the rulebook. */
export function isFramed(pathname: string): boolean {
    return pathname !== '/rulebook' && !isSitePage(pathname)
}
