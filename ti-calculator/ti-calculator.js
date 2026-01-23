function increaseCount(button) {
    const countEl = button.closest('.counter').querySelector('.count');
    countEl.textContent = Math.max(0, parseInt(countEl.textContent) + 1)
}

function decreaseCount(button) {
    const countEl = button.closest('.counter').querySelector('.count');
    countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1)
}

function createUnitRow(unitName) {
    const counterTpl = document.getElementById('counter-tpl');

    // Create defender counter
    const defenderCounter = counterTpl.content.cloneNode(true);
    defenderCount = defenderCounter.querySelector('.count')
    defenderCount.textContent = 0;
    defenderCount.dataset.unit = unitName;
    defenderCount.dataset.side = 'defender';

    // Create attacker counter
    const attackerCounter = counterTpl.content.cloneNode(true);
    attackerCount = attackerCounter.querySelector('.count')
    attackerCount.textContent = 0;
    attackerCount.dataset.unit = unitName;
    attackerCount.dataset.side = 'attacker';

    // Build row
    const rowFragment = document.getElementById('row-tpl').content.cloneNode(true);
    rowFragment.querySelector('.unit-name').textContent = unitName;
    rowFragment.querySelector('.unit-image').src = `assets/${unitName.toLowerCase().replace(' ', '_')}.webp`
    rowFragment.querySelector('.defender-counter').appendChild(defenderCounter);
    rowFragment.querySelector('.attacker-counter').appendChild(attackerCounter);

    // Add row to unit container
    document.getElementById("unit-container").appendChild(rowFragment)
}

function createUnitRows() {
    const units = ['Fighter', 'Carrier', 'Destroyer', 'Cruiser', 'Dreadnought', 'War Sun', 'Flagship', 'Infantry', 'Mech', "PDS", "Space Dock"];
    units.forEach(unit => createUnitRow(unit));
}

function resetUnitCount() {
    document.querySelectorAll('.count').forEach(count => {
        count.textContent = 0;
    })
}
