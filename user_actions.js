// user_actions.js - Handles user actions like creating new categories and tasks
//
// Write operations (creating a sheet, updating the Settings sheet) are now
// handled by Cloudflare Pages Functions in the functions/ directory using a
// Google Service Account – no browser-exposed credentials required.
//
// The /api/sheets/create-sheet endpoint:
//   POST { sheetId, title, settingsRow }
//   Creates a new sheet tab and appends a row to the Settings sheet.
//
// The /api/sheets/delete-sheet endpoint:
//   POST { sheetId, sheetName }
//   Deletes a sheet tab and removes its row from the Settings sheet.
//
// The /api/sheets/append endpoint:
//   POST { sheetId, range, values }
//   Appends rows to a given range in a Google Sheet.
//
// Authentication: all requests include the session token stored in
// sessionStorage (set by script.js after a successful /api/auth/login call)
// via the X-App-Auth header.  The session token is issued by the server and
// is never visible in the page source.

const newCategoryBtn = document.getElementById('newCategoryBtn');
const newCategoryModal = document.getElementById('newCategoryModal');
const newCategoryOkBtn = document.getElementById('newCategoryOkBtn');
const newCategoryCancelBtn = document.getElementById('newCategoryCancelBtn');
const categoryNameInput = document.getElementById('categoryName');
const categoryKeyInput = document.getElementById('categoryKey');
const newCategoryError = document.getElementById('newCategoryError');

const newTaskBtn = document.getElementById('newTaskBtn');
const newTaskModal = document.getElementById('newTaskModal');
const newTaskOkBtn = document.getElementById('newTaskOkBtn');
const newTaskCancelBtn = document.getElementById('newTaskCancelBtn');
const taskSheetSelect = document.getElementById('taskSheet');
const taskTextInput = document.getElementById('taskText');
const taskNotesInput = document.getElementById('taskNotes');
const newTaskError = document.getElementById('newTaskError');

const editTaskModal = document.getElementById('editTaskModal');
const editTaskOkBtn = document.getElementById('editTaskOkBtn');
const editTaskCancelBtn = document.getElementById('editTaskCancelBtn');
const editTaskSheet = document.getElementById('editTaskSheet');
const editTaskText = document.getElementById('editTaskText');
const editTaskNotes = document.getElementById('editTaskNotes');
const editTaskError = document.getElementById('editTaskError');

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

    newTaskBtn.addEventListener('click', async () => {
        if (!currentTasksSheetUrl) {
            return;
        }
        // Populate sheet dropdown
        taskSheetSelect.innerHTML = '';
        try {
            const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (sheetIdMatch) {
                const sheetNames = await loadSheetMetadata(sheetIdMatch[1]);
                const filtered = sheetNames.filter(name => name !== 'Settings');
                filtered.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    taskSheetSelect.appendChild(opt);
                });
            }
        } catch (_) {
            // Leave dropdown empty; validation will catch it
        }
        taskTextInput.value = '';
        taskNotesInput.value = '';
        newTaskError.textContent = '';
        newTaskOkBtn.disabled = false;
        newTaskModal.classList.remove('hidden');
        taskTextInput.focus();
    });

    newTaskCancelBtn.addEventListener('click', () => {
        newTaskModal.classList.add('hidden');
    });

    newTaskModal.addEventListener('click', (e) => {
        if (e.target === newTaskModal) {
            newTaskModal.classList.add('hidden');
        }
    });

    newTaskOkBtn.addEventListener('click', handleNewTaskOk);

    taskNotesInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleNewTaskOk();
    });

    editTaskCancelBtn.addEventListener('click', () => {
        editTaskModal.classList.add('hidden');
    });

    editTaskModal.addEventListener('click', (e) => {
        if (e.target === editTaskModal) {
            editTaskModal.classList.add('hidden');
        }
    });

    editTaskOkBtn.addEventListener('click', handleEditTaskOk);

    editTaskText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleEditTaskOk();
    });

    editTaskNotes.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleEditTaskOk();
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
        headers['X-App-Auth'] = getSessionToken() || '';

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

        await createSheetTabs(currentTasksSheetUrl);
        newCategoryModal.classList.add('hidden');
    } catch (err) {
        console.error('Error creating category:', err);
        newCategoryError.textContent = err.message || 'Failed to create category.';
        newCategoryOkBtn.disabled = false;
    }
}

async function handleNewTaskOk() {
    const selectedSheet = taskSheetSelect.value;
    const taskText = taskTextInput.value.trim();
    const taskNotes = taskNotesInput.value.trim();

    if (!selectedSheet) {
        newTaskError.textContent = 'Please select a sheet.';
        taskSheetSelect.focus();
        return;
    }
    if (!taskText) {
        newTaskError.textContent = 'Please enter a task.';
        taskTextInput.focus();
        return;
    }

    if (!currentTasksSheetUrl) {
        newTaskError.textContent = 'No tasks sheet loaded. Please log in first.';
        return;
    }

    const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
        newTaskError.textContent = 'Invalid tasks sheet URL.';
        return;
    }

    const spreadsheetId = sheetIdMatch[1];

    newTaskOkBtn.disabled = true;
    newTaskError.textContent = '';

    try {
        const headers = { 'Content-Type': 'application/json' };
        headers['X-App-Auth'] = getSessionToken() || '';

        // Build the range: quote sheet names that contain non-alphanumeric characters
        const escapedSheet = selectedSheet.replace(/'/g, "''");
        const quotedSheet = /[^A-Za-z0-9]/.test(selectedSheet) ? `'${escapedSheet}'` : escapedSheet;
        const range = `${quotedSheet}!A:B`;

        let response;
        try {
            response = await fetch('/api/sheets/append', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    sheetId: spreadsheetId,
                    range,
                    values: [[taskText, taskNotes]],
                }),
            });
        } catch (_) {
            throw new Error('Failed to connect to the server. Please check your connection.');
        }

        if (!response.ok) {
            let errMsg = `Server responded with status ${response.status}.`;
            try {
                const result = await response.json();
                errMsg = result.error || errMsg;
            } catch (_) { /* ignore */ }
            throw new Error(errMsg);
        }

        newTaskModal.classList.add('hidden');

        // Reload tasks: switch to the sheet where the task was added
        const tabs = document.querySelectorAll('.sheet-tab');
        for (const tab of tabs) {
            if (tab.textContent === selectedSheet) {
                await switchToTab(tab, currentTasksSheetUrl, selectedSheet);
                break;
            }
        }
    } catch (err) {
        console.error('Error adding task:', err);
        newTaskError.textContent = err.message || 'Failed to add task.';
        newTaskOkBtn.disabled = false;
    }
}

async function handleEditTaskOk() {
    const selectedSheet = editTaskSheet.value;
    const taskText = editTaskText.value.trim();
    const taskNotes = editTaskNotes.value.trim();
    const originalSheet = editTaskModal.dataset.originalSheet;
    const rowIndex = parseInt(editTaskModal.dataset.rowIndex, 10);

    if (!taskText) {
        editTaskError.textContent = 'Please enter a task.';
        editTaskText.focus();
        return;
    }

    if (!currentTasksSheetUrl) {
        editTaskError.textContent = 'No tasks sheet loaded. Please log in first.';
        return;
    }

    const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
        editTaskError.textContent = 'Invalid tasks sheet URL.';
        return;
    }

    const spreadsheetId = sheetIdMatch[1];
    editTaskOkBtn.disabled = true;
    editTaskError.textContent = '';

    try {
        const headers = { 'Content-Type': 'application/json' };
        headers['X-App-Auth'] = getSessionToken() || '';

        if (selectedSheet === originalSheet) {
            // Same category: update the row in place (rowIndex is 0-based; Sheets API is 1-based)
            const escapedSheet = originalSheet.replace(/'/g, "''");
            const quotedSheet = /[^A-Za-z0-9]/.test(originalSheet) ? `'${escapedSheet}'` : escapedSheet;
            const rowNumber = rowIndex + 1;
            const range = `${quotedSheet}!A${rowNumber}:B${rowNumber}`;

            let response;
            try {
                response = await fetch('/api/sheets/update', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        sheetId: spreadsheetId,
                        range,
                        values: [[taskText, taskNotes]],
                    }),
                });
            } catch (fetchErr) {
                console.warn('Network error updating task:', fetchErr);
                throw new Error('Failed to connect to the server. Please check your connection.');
            }

            if (!response.ok) {
                let errMsg = `Server responded with status ${response.status}.`;
                try {
                    const result = await response.json();
                    errMsg = result.error || errMsg;
                } catch (_) { /* ignore */ }
                throw new Error(errMsg);
            }
        } else {
            // Different category: append to new sheet, then delete from old sheet
            const escapedNew = selectedSheet.replace(/'/g, "''");
            const quotedNew = /[^A-Za-z0-9]/.test(selectedSheet) ? `'${escapedNew}'` : escapedNew;
            const newRange = `${quotedNew}!A:B`;

            let appendResponse;
            try {
                appendResponse = await fetch('/api/sheets/append', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        sheetId: spreadsheetId,
                        range: newRange,
                        values: [[taskText, taskNotes]],
                    }),
                });
            } catch (fetchErr) {
                console.warn('Network error appending task to new category:', fetchErr);
                throw new Error('Failed to add task to new category. Please check your connection.');
            }

            if (!appendResponse.ok) {
                let errMsg = `Server responded with status ${appendResponse.status}.`;
                try {
                    const result = await appendResponse.json();
                    errMsg = result.error || errMsg;
                } catch (_) { /* ignore */ }
                throw new Error('Failed to add task to new category: ' + errMsg);
            }

            let deleteResponse;
            try {
                deleteResponse = await fetch('/api/sheets/delete-row', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        sheetId: spreadsheetId,
                        sheetName: originalSheet,
                        rowIndex,
                    }),
                });
            } catch (fetchErr) {
                console.warn('Network error deleting task from original category:', fetchErr);
                throw new Error('Task was added to the new category but could not be removed from the original category. You may see the task duplicated.');
            }

            if (!deleteResponse.ok) {
                let errMsg = `Server responded with status ${deleteResponse.status}.`;
                try {
                    const result = await deleteResponse.json();
                    errMsg = result.error || errMsg;
                } catch (_) { /* ignore */ }
                throw new Error('Task was added to the new category but could not be removed from the original category. You may see the task duplicated. (' + errMsg + ')');
            }
        }

        editTaskModal.classList.add('hidden');

        // Reload tasks: switch back to the original sheet tab
        const tabs = document.querySelectorAll('.sheet-tab');
        for (const tab of tabs) {
            if (tab.textContent === originalSheet) {
                await switchToTab(tab, currentTasksSheetUrl, originalSheet);
                break;
            }
        }
    } catch (err) {
        console.error('Error editing task:', err);
        editTaskError.textContent = err.message || 'Failed to edit task.';
        editTaskOkBtn.disabled = false;
    }
}

