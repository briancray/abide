const tabs = document.querySelectorAll('[data-invoice]')
const address = document.querySelector('#address')

// THE ADDRESS IS WRITTEN AND THEN READ BACK BY HAND: `replaceState`
// tells nothing on the page, so every reader of it is re-rendered
// from here — and from `popstate`, for the step the browser takes.
function render() {
    const open =
        new URL(location.href).searchParams.get('invoice') ?? '4310'
    for (const tab of tabs)
        tab.setAttribute('aria-selected', String(tab.dataset.invoice === open))
    address.textContent = location.search || '—'
}

for (const tab of tabs)
    tab.addEventListener('click', () => {
        history.replaceState(null, '', `?invoice=${tab.dataset.invoice}`)
        render()
    })

window.addEventListener('popstate', render)

render()
