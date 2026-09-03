import { analytics } from './analytics.js'

const draft = document.querySelector('#draft')
const topic = document.querySelector('#topic')
const saved = document.querySelector('#saved')

// The handle the effect's return value replaces. Every path that
// starts a timer has to remember this one, and the teardown path
// has to exist at all — there is no unmount here to run it, so
// `pagehide` is the stand-in.
let timer = 0

function autosave() {
    clearTimeout(timer)
    const body = draft.value
    timer = setTimeout(async () => {
        await fetch('/api/drafts', { method: 'POST', body })
        saved.textContent = 'just now'
        document.title = 'Draft — saved just now'
    }, 1000)
}

// The `sources` list by hand: this listener is on the topic and reads
// the draft, which is the only reason a keystroke does not reach
// it. Written as one tracked handler it would have.
function compose() {
    analytics.compose(topic.value, draft.value.length)
}

draft.addEventListener('input', autosave)
topic.addEventListener('change', compose)
addEventListener('pagehide', () => clearTimeout(timer))

document.title = 'Draft'
compose()
