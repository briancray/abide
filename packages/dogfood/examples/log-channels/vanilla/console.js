const list = document.querySelector('#records')

// `DEBUG` decides which namespaces emit. Here it is a constant; in an app
// it is the environment, and the point is the same either way — a line
// on a namespace nothing selected is never built.
const DEBUG = 'billing'

const TAIL = 20

const records = []
const readers = new Set()

function enabled(namespace) {
    return DEBUG.split(',').some((one) => one.trim() === namespace)
}

function publish(namespace, level, message, data) {
    if (!enabled(namespace)) return
    records.push({ namespace, level, message, data })
    if (records.length > TAIL) records.shift()
    for (const reader of readers) reader()
}

// A NAMED LOGGER IS A BOUND PUBLISHER, and the gate is checked at the call so
// an argument object for a line nobody selected is never allocated.
function named(name) {
    return {
        info: (message, data) => publish(name, 'info', message, data),
        debug: (message, data) => publish(name, 'debug', message, data),
    }
}

const billing = named('billing')
const sync = named('sync')

function render() {
    list.replaceChildren()
    for (const record of records) {
        const row = document.createElement('li')
        const name = document.createElement('span')
        name.textContent = record.namespace
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
