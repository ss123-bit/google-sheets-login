// user_actions.js - Handles user actions like creating new categories
//
// Write operations (creating a sheet, updating the Settings sheet) are performed
// via a Google Apps Script Web App that runs server-side with the owner's
// credentials. No OAuth 2.0 or Client ID is required in the browser.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// 1. Open https://script.google.com and create a new project.
// 2. Paste the code below (between the dashed lines) into the editor.
// 3. Click Deploy → New Deployment → Web App.
//    · Execute as: Me
//    · Who has access: Anyone
// 4. Copy the Web App URL and paste it into CONFIG.APPS_SCRIPT_URL in script.js.
//
// ── Apps Script code ─────────────────────────────────────────────────────────
// function doPost(e) {
//   try {
//     var params = JSON.parse(e.postData.contents);
//     var spreadsheetId = params.spreadsheetId;
//     var categoryName  = params.categoryName;
//     var categoryKey   = params.categoryKey;
//
//     var ss = SpreadsheetApp.openById(spreadsheetId);
//
//     // Check for duplicate sheet name before creating
//     if (ss.getSheetByName(categoryName)) {
//       return ContentService
//         .createTextOutput(JSON.stringify({ success: false, error: 'A sheet named "' + categoryName + '" already exists.' }))
//         .setMimeType(ContentService.MimeType.JSON);
//     }
//
//     // Create new sheet at the end of the workbook
//     ss.insertSheet(categoryName, ss.getSheets().length);
//
//     // Append category name + key to the Settings sheet
//     var settingsSheet = ss.getSheetByName('Settings');
//     settingsSheet.appendRow([categoryName, categoryKey]);
//
//     return ContentService
//       .createTextOutput(JSON.stringify({ success: true }))
//       .setMimeType(ContentService.MimeType.JSON);
//   } catch (err) {
//     return ContentService
//       .createTextOutput(JSON.stringify({ success: false, error: err.message }))
//       .setMimeType(ContentService.MimeType.JSON);
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────

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

    if (!CONFIG.APPS_SCRIPT_URL) {
        newCategoryError.textContent = 'APPS_SCRIPT_URL is not configured. Please set CONFIG.APPS_SCRIPT_URL in script.js.';
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
        let response;
        try {
            // Use text/plain to avoid a CORS preflight; the Apps Script web app
            // accepts JSON in the request body regardless of Content-Type.
            response = await fetch(CONFIG.APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ spreadsheetId, categoryName, categoryKey })
            });
        } catch (_) {
            throw new Error('Failed to connect to Apps Script. Please check your connection and APPS_SCRIPT_URL configuration.');
        }

        if (!response.ok) {
            throw new Error(`Server responded with status ${response.status}.`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to create category.');
        }

        location.reload();
    } catch (err) {
        console.error('Error creating category:', err);
        newCategoryError.textContent = err.message || 'Failed to create category.';
        newCategoryOkBtn.disabled = false;
    }
}

