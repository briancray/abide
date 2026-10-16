const banner = document.querySelector('#banner')
const connection = document.querySelector('#connection')

// TWO LISTENERS AND A FLAG between them, kept in step by hand —
// the flag is seeded from `navigator.onLine` and then only moves
// when one of the two events says so.
let online = navigator.onLine

function render() {
    banner.hidden = online
    connection.textContent = online ? 'online' : 'offline'
}

window.addEventListener('online', () => {
    online = true
    render()
})

window.addEventListener('offline', () => {
    online = false
    render()
})

render()
