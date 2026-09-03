// One half of the store, in the browser's spelling. The other half
// is in `server.ts`, in the server's — and nothing keeps the two
// in step, which is the whole of what one both-sides option
// removes.
const button = document.querySelector('#theme')
const value = document.querySelector('#value')

function read() {
    const match = document.cookie.match(/(?:^|; )theme=([^;]*)/)
    return match ? decodeURIComponent(match[1]) : 'light'
}

// Not even the same API as the read: the restore has to be
// synchronous to beat the first paint, and the persist does not.
function write(theme) {
    cookieStore.set({ name: 'theme', value: theme, path: '/' })
}

let theme = read()

function render() {
    value.textContent = theme
    document.documentElement.dataset.theme = theme
}

button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'
    write(theme)
    render()
})

render()
