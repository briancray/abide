let id = '1'
let current = null

// THE ENTRY TABLE, WRITTEN BY HAND. Without it, opening a tab
// already loaded is a second request and a second spinner —
// which is what the record's own `opened` count reports.
const entries = new Map()

function entryFor(next) {
    const held = entries.get(next)
    if (held) return held
    const entry = { profile: null, pending: true }
    entries.set(next, entry)
    fetch(`/api/profile?id=${next}`)
        .then((response) => response.json())
        .then((profile) => {
            entry.profile = profile
            entry.pending = false
            render()
        })
    return entry
}

const TABS = [
    ['#ada', '1'],
    ['#grace', '2'],
]

function statusOf() {
    if (!current.pending) return ''
    return current.profile ? 'refreshing…' : 'loading…'
}

function render() {
    const shown = {
        name: current.profile?.name ?? '—',
        role: current.profile?.role ?? '—',
        opened: current.profile?.opened ?? '—',
        status: statusOf(),
    }
    for (const [tile, text] of Object.entries(shown)) {
        document.querySelector(`#${tile}`).textContent = String(text)
    }
    for (const [button, tab] of TABS) {
        document.querySelector(button).ariaSelected = String(tab === id)
    }
}

for (const [button, next] of TABS) {
    document.querySelector(button).addEventListener('click', () => {
        id = next
        current = entryFor(id)
        render()
    })
}

current = entryFor(id)
render()
