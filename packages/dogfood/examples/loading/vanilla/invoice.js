// The three variables the framework replaces with one value, kept
// in step by hand: this is the pair that disagrees on the reload.
const state = { invoice: null, loading: false, reloading: false, error: null }

const strip = document.querySelector('#progress')
const heading = document.querySelector('#number')
const line = document.querySelector('#line')
const spinner = document.querySelector('#updating')
const refresh = document.querySelector('#refresh')

function render() {
    strip.hidden = !(state.loading || state.reloading)
    spinner.hidden = !state.reloading
    refresh.disabled = state.loading || state.reloading

    if (state.error) {
        heading.textContent = 'Invoice '
        line.textContent = 'Could not load that invoice.'
        line.className = 'error'
        return
    }
    line.className = ''
    heading.textContent = `Invoice ${state.invoice ? state.invoice.number : ''}`
    line.textContent = state.invoice
        ? `${state.invoice.total} due ${state.invoice.dueOn}`
        : ' due '
}

async function load(id, { reload = false } = {}) {
    // The distinction the probes make for free, spelled out: a
    // reload must not clear the row, and must not raise `loading`.
    state[reload ? 'reloading' : 'loading'] = true
    state.error = null
    render()
    try {
        const response = await fetch(`/api/invoices/${id}`)
        if (!response.ok) throw await response.json()
        state.invoice = await response.json()
    } catch (failure) {
        state.error = failure
        state.invoice = null
    } finally {
        state.loading = false
        state.reloading = false
        render()
    }
}

refresh.addEventListener('click', () => load('42', { reload: true }))

render()
load('42')
