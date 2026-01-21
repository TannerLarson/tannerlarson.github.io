function selectPlayers(count) {
    document.querySelector('.player-select').style.display = 'none';

    const numCards = count === '2-3' ? 5: 4;
    const container = document.getElementById('card-container');

    for (let i = 0; i < numCards; i++) {
        const card = createCard(i)
        container.appendChild(card);
    }

    document.getElementById('hint-card-container').appendChild(createHintCard(numCards))
}

document.getElementById('players-2-3').addEventListener('click', () => selectPlayers('2-3'))
document.getElementById('players-4-5').addEventListener('click', () => selectPlayers('4-5'))

function createCard(index) {
    // Copy card template from index.html
    const template = document.getElementById('card-template')
    const card = template.content.cloneNode(true);

    // Figure out card name
    card.querySelector('.card-title').textContent = `Card ${index + 1}`;

    createBadges(card)

    // Add click handlers to all badges
    card.querySelectorAll('.badge').forEach(badge => {
        badge.addEventListener('click', function() {
            cycleBadges(this);
        })
    });

    // Add click handlers to Play Card button
    card.querySelector('.play-card-btn').addEventListener('click', function() {
        playCard(this);
    })

    return card;
}

function createBadges(card) {
    // Create color badges
    const colors = ['R', 'G', "B", "Y", "W"];
    const colorContainer = card.querySelector('.color-badges');
    colors.forEach(color => {
        const badge = document.createElement('span');
        badge.className = 'badge color-badge';
        badge.textContent = color;
        badge.dataset.state = 'possible';
        badge.dataset.value = color;
        colorContainer.appendChild(badge);
    })

    // Create number badges
    const numbers = [1,2,3,4,5];
    const numberContainer = card.querySelector('.number-badges')
    numbers.forEach(num => {
        const badge = document.createElement('span');
        badge.className = 'badge number-badge';
        badge.textContent = num;
        badge.dataset.state = 'possible';
        badge.dataset.value = num;
        numberContainer.appendChild(badge);
    })
}


function cycleBadges(badge) {
    const currentState = badge.dataset.state;
    const states = ['possible', 'eliminated', 'confirmed'];
    const currentIndex = states.indexOf(currentState);
    const nextState = states[(currentIndex + 1) % states.length];

    badge.dataset.state = nextState;

    if (nextState === 'confirmed') {
        deselectBadges(badge)
    }
}

function deselectBadges(badge) {
    const isColorBadge = badge.classList.contains('color-badge');
    const selector = isColorBadge ? '.color-badge' : '.number-badge';
    const cardElement = badge.closest('.card');

    cardElement.querySelectorAll(selector).forEach(otherBadge => {
        if (otherBadge !== badge) {
            otherBadge.dataset.state = 'eliminated';
        }
    });
}

function playCard(button) {
    const cardElement = button.closest('.card')
    cardElement.querySelectorAll('.badge').forEach(badge => {
        badge.dataset.state = 'possible'
    })
}

function createHintCard(numCards) {
    // Copy card template from index.html
    const template = document.getElementById('hint-card-template')
    const card = template.content.cloneNode(true);

    card.querySelector('.card-title').textContent = 'Hint'

    // Create checkboxes for each card
    const cardSelectContainer = card.querySelector('.card-select')
    const labelRow = document.createElement('div');
    labelRow.className = 'checkbox-label-row';
    const checkboxRow = document.createElement('div');
    checkboxRow.className = 'checkbox-input-row';
    for (let i = 0; i < numCards; i++) {
        const label = document.createElement('div');
        label.textContent = i + 1;
        label.clasName = 'checkbox-label'
        labelRow.appendChild(label);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = i;
        checkbox.className = 'card-checkbox';
        checkboxRow.appendChild(checkbox)
    }
    cardSelectContainer.appendChild(labelRow);
    cardSelectContainer.appendChild(checkboxRow);

    createBadges(card)

    // Add click handlers to all badges
    card.querySelectorAll('.badge').forEach(badge => {
        badge.addEventListener('click', function() {
            const currentState = badge.dataset.state;
            if (badge.dataset.state !== 'confirmed') {
                badge.dataset.state = 'confirmed'
                deselectBadges(badge)
            }
        })
    });

    // Add click handlers to Play Card button
    card.querySelector('.apply-hint-btn').addEventListener('click', function() {
        applyHint(this);
    })

    return card;
}

function applyHint(button) {
    const cardElement = button.closest('.card')
    cardElement.querySelectorAll('.badge').forEach(badge => {
        badge.dataset.state = 'possible'
    })
}
