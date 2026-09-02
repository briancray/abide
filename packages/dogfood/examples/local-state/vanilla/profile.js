const state = { profile: null, handle: '' }

const heading = document.querySelector('#name')
const input = document.querySelector('#handle')
const saved = document.querySelector('#saved')
const save = document.querySelector('#save')

function normalise(value) {
    return value.trim().toLowerCase()
}

function render() {
    heading.textContent = state.profile ? state.profile.name : ''
    saved.textContent = state.handle
    input.disabled = !state.profile
    save.disabled = !state.profile
}

input.addEventListener('input', () => {
    state.handle = normalise(input.value)
    render()
})

save.addEventListener('click', () => {
    state.profile = { ...state.profile, handle: state.handle }
    render()
})

async function load() {
    const response = await fetch('/api/profile')
    if (!response.ok) throw new Error('profile failed')
    state.profile = await response.json()
    state.handle = normalise(state.profile.handle)
    input.value = state.profile.name
    render()
}

render()
load()
