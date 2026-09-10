const list = document.querySelector('#rows')

// MODULE SCOPE, WHICH IS FREE HERE AND IS THE TRAP. A variable beside
// the factory is shared by every instance whether that was meant or
// not, so the per-instance half is the one that has to be arranged —
// and the one that is arranged by accident is the shared one.
let opened = 0

function Row(name) {
    opened += 1
    const seat = opened

    let calls = 0

    const item = document.createElement('li')
    const label = document.createElement('span')
    label.textContent = name
    const shown = document.createElement('strong')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Log a call'

    const render = () => {
        shown.textContent = `${calls} calls · row ${seat}`
    }

    button.addEventListener('click', () => {
        calls += 1
        render()
    })

    render()
    item.append(label, shown, button)
    return item
}

list.append(Row('Ada Lovelace'), Row('Grace Hopper'))
