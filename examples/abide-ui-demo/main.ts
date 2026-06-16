import { startClient } from '@abide/abide/ui/startClient'
import About from './About.abide'
import Data from './Data.abide'
import Form from './Form.abide'
import Home from './Home.abide'

/* Client entry: abide-ui's startClient seeds the tab cache store from the server's
   __SSR__ snapshot, installs the mount base, and starts the router — which adopts
   the server-rendered #app for the initial route, then drives SPA navigation. No
   clearing, no re-render on load; even `/data` resumes from the stream's value. */
startClient({ '/': Home, '/about': About, '/form': Form, '/data': Data })
