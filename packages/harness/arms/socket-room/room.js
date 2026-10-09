const turn = document.querySelector('#turn')
const speaker = document.querySelector('#speaker')
const said = document.querySelector('#said')
const draft = document.querySelector('#draft')

// THIS BROWSER'S ROOM: an id in a cookie, read by every tab it opens.
let room = null
for (const pair of document.cookie.split('; ')) {
    const [name, value] = pair.split('=')
    if (name === 'room') room = decodeURIComponent(value)
}
room ??= crypto.randomUUID()
// biome-ignore lint/suspicious/noDocumentCookie: the hand-written arm writes the cookie the way a page with no framework does.
document.cookie = `room=${room}; Path=/; SameSite=Lax`

const ADDRESS = new URL('/room', location.href)
ADDRESS.protocol = ADDRESS.protocol === 'https:' ? 'wss:' : 'ws:'
ADDRESS.searchParams.set('id', room)

// THE CONNECTION IS THE PAGE'S TO KEEP: opened, framed, and opened again
// when it drops — and a frame sent while it is down is held until then.
let socket = null
let retry = 250
const held = []

function connect() {
    socket = new WebSocket(ADDRESS.href)
    socket.addEventListener('open', () => {
        retry = 250
        for (const text of held.splice(0)) socket.send(text)
    })
    socket.addEventListener('message', (event) => {
        const latest = JSON.parse(event.data)
        turn.dataset.speaker = latest.speaker
        speaker.textContent = latest.speaker
        said.textContent = latest.text
    })
    socket.addEventListener('close', () => {
        setTimeout(connect, retry)
        retry = Math.min(retry * 2, 10_000)
    })
}

document.querySelector('#send').addEventListener('click', () => {
    const text = JSON.stringify({ speaker: 'you', text: draft.value })
    if (socket.readyState === WebSocket.OPEN) socket.send(text)
    else held.push(text)
})

connect()
