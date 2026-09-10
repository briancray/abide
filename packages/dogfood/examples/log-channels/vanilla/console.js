const list = document.querySelector('#records')

// `DEBUG` decides which channels emit. Here it is a constant; in an app
// it is the environment, and the point is the same either way — a line
// on a channel nothing selected is never built.
const DEBUG = 'billing'

const TAIL = 20

const records = []
const readers = new Set()

function enabled(channel) {
    return DEBUG.split(',').some((one) => one.trim() === channel)
}

function publish(channel, level, message, data) {
    if (!enabled(channel)) return
    records.push({ channel, level, message, data })
    if (records.length > TAIL) records.shift()
    for (const reader of readers) reader()
}

// A CHANNEL IS A BOUND PUBLISHER, and the gate is checked at the call so
// an argument object for a line nobody selected is never allocated.
function channel(name) {
    return {
        info: (message, data) => publish(name, 'info', message, data),
        debug: (message, data) => publish(name, 'debug', message, data),
    }
}

const billing = channel('billing')
const sync = channel('sync')

function render() {
    list.replaceChildren()
    for (const record of records) {
        const row = document.createElement('li')
        const name = document.createElement('span')
        name.textContent = record.channel
        const message = document.createElement('strong')
        message.textContent = record.message
        row.append(name, message)
        list.append(row)
    }
}

readers.add(render)

document.querySelector('#send').addEventListener('click', () => {
    billing.info('invoice sent', { id: '4310' })
})

document.querySelector('#poll').addEventListener('click', () => {
    sync.debug('polled', { rows: 0 })
})

render()
