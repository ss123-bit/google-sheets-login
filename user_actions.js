// user_actions.js - Handles user actions like creating new categories

const newCategoryBtn = document.getElementById('newCategoryBtn');
const newCategoryModal = document.getElementById('newCategoryModal');
const newCategoryOkBtn = document.getElementById('newCategoryOkBtn');
const newCategoryCancelBtn = document.getElementById('newCategoryCancelBtn');
const categoryNameInput = document.getElementById('categoryName');
const categoryKeyInput = document.getElementById('categoryKey');
const newCategoryError = document.getElementById('newCategoryError');

let tokenClient = null;

function initTokenClient() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2 && CONFIG.CLIENT_ID) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            callback: () => {}
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    newCategoryBtn.addEventListener('click', () => {
        categoryNameInput.value = '';
        categoryKeyInput.value = '';
        newCategoryError.textContent = '';
        newCategoryOkBtn.disabled = false;
        newCategoryModal.classList.remove('hidden');
        categoryNameInput.focus();
    });

    newCategoryCancelBtn.addEventListener('click', () => {
        newCategoryModal.classList.add('hidden');
    });

    newCategoryModal.addEventListener('click', (e) => {
        if (e.target === newCategoryModal) {
            newCategoryModal.classList.add('hidden');
        }
    });

    newCategoryOkBtn.addEventListener('click', handleNewCategoryOk);

    categoryKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleNewCategoryOk();
    });

    // Initialize the GIS token client once the library has loaded
    if (typeof google !== 'undefined') {
        initTokenClient();
    } else {
        window.addEventListener('load', initTokenClient);
    }
});

async function handleNewCategoryOk() {
    const categoryName = categoryNameInput.value.trim();
    const categoryKey = categoryKeyInput.value.trim();

    if (!categoryName) {
        newCategoryError.textContent = 'Please enter a Category Name.';
        categoryNameInput.focus();
        return;
    }
    if (!categoryKey) {
        newCategoryError.textContent = 'Please enter a Category Key.';
        categoryKeyInput.focus();
        return;
    }

    if (!currentTasksSheetUrl) {
        // currentTasksSheetUrl is defined as a global in script.js and set after login
        newCategoryError.textContent = 'No tasks sheet loaded. Please log in first.';
        return;
    }

    const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
        newCategoryError.textContent = 'Invalid tasks sheet URL.';
        return;
    }

    const tasksSheetId = sheetIdMatch[1];

    newCategoryOkBtn.disabled = true;
    newCategoryError.textContent = '';

    try {
        const accessToken = await getAccessToken();

        await createNewSheet(tasksSheetId, categoryName, accessToken);
        await appendToSettingsSheet(tasksSheetId, categoryName, categoryKey, accessToken);

        location.reload();
    } catch (err) {
        console.error('Error creating category:', err);
        newCategoryError.textContent = err.message || 'Failed to create category.';
        newCategoryOkBtn.disabled = false;
    }
}

function getAccessToken() {
    return new Promise((resolve, reject) => {
        // Ensure the token client is initialized (GIS may have loaded after DOMContentLoaded)
        if (!tokenClient) {
            initTokenClient();
        }
        if (!tokenClient) {
            reject(new Error(
                CONFIG.CLIENT_ID
                    ? 'Google Identity Services not loaded. Please refresh and try again.'
                    : 'CLIENT_ID is not configured. Please set CONFIG.CLIENT_ID in script.js.'
            ));
            return;
        }

        tokenClient.callback = (response) => {
            if (response.error) {
                reject(new Error(response.error));
            } else {
                resolve(response.access_token);
            }
        };

        tokenClient.requestAccessToken();
    });
}

async function createNewSheet(spreadsheetId, sheetName, accessToken) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const body = {
        requests: [{
            addSheet: {
                properties: {
                    title: sheetName
                }
            }
        }]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to create new sheet.');
    }
}

async function appendToSettingsSheet(spreadsheetId, categoryName, categoryKey, accessToken) {
    const range = 'Settings!A:B';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    const body = {
        values: [[categoryName, categoryKey]]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to update Settings sheet.');
    }
}
