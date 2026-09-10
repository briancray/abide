import { GET } from 'abide/server'

// THE GATE A VIEW BRANCHES ON: what this caller may do with the
// record, which is a question only the server can answer and so
// is a value a page has to wait for.
export const getViewer = GET(() => ({ readOnly: true }))
