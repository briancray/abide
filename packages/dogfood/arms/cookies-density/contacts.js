const tabs = document.querySelectorAll('[data-density]')
const shown = document.querySelector('#density')

// `document.cookie` IS ONE STRING, parsed on every read and written
// a line at a time — and it tells nothing on the page that it moved.
function read() {
    for (const pair of document.cookie.split('; ')) {
        const [name, value] = pair.split('=')
        if (name === 'density') return decodeURIComponent(value)
    }
    return 'comfortable'
}

function render() {
    const density = read()
    for (const tab of tabs)
        tab.setAttribute(
            'aria-selected',
            String(tab.dataset.density === density),
        )
    shown.textContent = density
}

for (const tab of tabs)
    tab.addEventListener('click', () => {
        // biome-ignore lint/suspicious/noDocumentCookie: the hand-written arm writes the cookie the way a page with no framework does.
        document.cookie = `density=${tab.dataset.density}; Path=/; SameSite=Lax`
        render()
    })

render()
