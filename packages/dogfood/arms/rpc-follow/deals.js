const list = document.querySelector('#deals')

function render(deals) {
    list.replaceChildren(
        ...deals.map((deal) => {
            const row = document.createElement('li')
            const stage = document.createElement('span')
            stage.textContent = deal.stage
            const name = document.createElement('strong')
            name.textContent = deal.name
            row.append(stage, name)
            return row
        }),
    )
}

// THE FIRST LOAD AND THE FEED ARE TWO CHANNELS, written by hand: a
// fetch for what stands, and a socket for what changes after it —
// with the version the answer named, or a change landing between the
// two is lost, and without it the whole list is sent twice.
const answered = await fetch('/api/deals')
render(await answered.json())
const version = Number(answered.headers.get('x-version'))

const socket = new WebSocket(
    `${location.origin.replace('http', 'ws')}/api/deals/live`,
)
socket.onopen = () => socket.send(JSON.stringify({ since: version }))
socket.onmessage = (event) => render(JSON.parse(String(event.data)).deals)

document.querySelector('#advance').addEventListener('click', () => {
    fetch('/api/deals/advance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'acme' }),
    })
})
