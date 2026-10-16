const subscribed = document.querySelector('#subscribed')
const advanced = document.querySelector('#advanced')
const reminders = document.querySelector('#reminders')
const openState = document.querySelector('#state')

// A DISCLOSURE'S OPEN STATE LIVES IN THE DOM unless something goes
// and fetches it, so the rest of the page cannot branch on it
// without this listener existing first.
const form = { subscribed: true, showAdvanced: false }

function render() {
    reminders.textContent = form.subscribed ? 'on' : 'off'
    openState.textContent = form.showAdvanced ? 'open' : 'shut'
}

subscribed.addEventListener('change', (event) => {
    form.subscribed = event.target.checked
    render()
})

advanced.addEventListener('toggle', () => {
    form.showAdvanced = advanced.open
    render()
})

render()
