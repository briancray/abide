import { router } from 'belte/ui/router'
import About from './About.belte'
import Data from './Data.belte'
import Form from './Form.belte'
import Home from './Home.belte'

/* Client entry: the router adopts the server-rendered #app in place (hydration)
   for the initial route, then drives SPA navigation — no clearing, no re-render
   on load. Even the `/data` route resumes: its streamed `await` value is read from
   the resume manifest, so the resolved list is adopted without re-fetching. */
const app = document.getElementById('app')
if (app !== null) {
    router(app, { '/': Home, '/about': About, '/form': Form, '/data': Data })
}
