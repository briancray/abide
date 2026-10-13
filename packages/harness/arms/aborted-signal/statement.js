const cancel = document.querySelector('#cancel')
const status = document.querySelector('#status')
const statement = document.querySelector('#statement')

// THE ABORT IS A THROW, so the canceled state is told apart from a
// failure by the error's name, and every flag the load set is unset
// again on each of the three ways out.
let stop

document.querySelector('#load').addEventListener('click', async () => {
    stop = new AbortController()
    cancel.disabled = false
    status.textContent = 'loading…'
    try {
        const response = await fetch('/api/statement?id=4021', {
            signal: stop.signal,
        })
        statement.textContent = (await response.json()).total
    } catch (error) {
        if (error.name !== 'AbortError') throw error
        statement.textContent = 'canceled'
    } finally {
        cancel.disabled = true
        status.textContent = ''
    }
})

cancel.addEventListener('click', () => stop.abort())
