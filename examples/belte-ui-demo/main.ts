import { router } from 'belte/ui/router'
import About from './About.belte'
import Data from './Data.belte'
import Form from './Form.belte'
import Home from './Home.belte'

/* Client entry: take over the server-rendered shell and drive SPA routing.
   (No DOM-adoption yet, so clear the SSR markup and mount fresh — identical
   output, just live handlers + client navigation.) */
const app = document.getElementById('app')
if (app !== null) {
    app.innerHTML = ''
    router(app, { '/': Home, '/about': About, '/form': Form, '/data': Data })
}
