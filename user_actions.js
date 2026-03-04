// user_actions.js - Handles user actions like creating new categories
//
// Write operations (creating a sheet, updating the Settings sheet) are now
// handled by Cloudflare Pages Functions in the functions/ directory using a
// Google Service Account – no browser-exposed credentials required.
//
// The /api/sheets/create-sheet endpoint:
//   POST { sheetId, title, settingsRow }
//   Creates a new sheet tab and appends a row to the Settings sheet.
//
// If APP_AUTH_SECRET is configured as a Cloudflare Pages environment variable,
// set CONFIG.APP_AUTH in script.js to the same value so that write requests
// are accepted by the backend.

const newCategoryBtn = document.getElementById('newCategoryBtn');
const newCategoryModal = document.getElementById('newCategoryModal');
const newCategoryOkBtn = document.getElementById('newCategoryOkBtn');
const newCategoryCancelBtn = document.getElementById('newCategoryCancelBtn');
const categoryNameInput = document.getElementById('categoryName');
const categoryKeyInput = document.getElementById('categoryKey');
const newCategoryError = document.getElementById('newCategoryError');

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

    const spreadsheetId = sheetIdMatch[1];

    newCategoryOkBtn.disabled = true;
    newCategoryError.textContent = '';

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (CONFIG.APP_AUTH) {
            headers['X-App-Auth'] = CONFIG.APP_AUTH;
        }

        let response;
        try {
            response = await fetch('/api/sheets/create-sheet', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    sheetId: spreadsheetId,
                    title: categoryName,
                    settingsRow: [categoryName, categoryKey],
                }),
            });
        } catch (_) {
            throw new Error('Failed to connect to the server. Please check your connection.');
        }

        let result;
        try {
            result = await response.json();
        } catch (_) {
            throw new Error(`Invalid response from server (status ${response.status}).`);
        }

        if (!response.ok) {
            throw new Error(result.error || `Server responded with status ${response.status}.`);
        }

        if (!result.success) {
            throw new Error(result.error || 'Failed to create category.');
        }

        if (result.warning) {
            console.warn('New category warning:', result.warning);
        }

        location.reload();
    } catch (err) {
        console.error('Error creating category:', err);
        newCategoryError.textContent = err.message || 'Failed to create category.';
        newCategoryOkBtn.disabled = false;
    }
}

