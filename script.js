// Session token storage key
const SESSION_TOKEN_KEY = 'app_session_token';

/**
 * Returns the stored session token (from sessionStorage), or null if not set.
 * sessionStorage is cleared automatically when the browser tab is closed.
 */
function getSessionToken() {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

/**
 * Returns headers for authenticated API requests.
 * Includes X-App-Auth with the session token when available.
 */
function getAuthHeaders(extra = {}) {
    const token = getSessionToken();
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (token) headers['X-App-Auth'] = token;
    return headers;
}

// How many pixels to scroll when a scroll-tab button is clicked
const TAB_SCROLL_STEP = 150;

// DOM Elements
const loginPage = document.getElementById('loginPage');
const tasksPage = document.getElementById('tasksPage');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('errorMessage');
const loadingSpinner = document.getElementById('loadingSpinner');
const welcomeUsername = document.getElementById('welcomeUsername');
const sheetTabs = document.getElementById('sheetTabs');
const tasksList = document.getElementById('tasksList');
const noTasks = document.getElementById('noTasks');
const logoutBtn = document.getElementById('logoutBtn');
const scrollTabsLeft = document.getElementById('scrollTabsLeft');
const scrollTabsRight = document.getElementById('scrollTabsRight');
const settingsBtn = document.getElementById('settingsBtn');
const deleteCategoryBtn = document.getElementById('deleteCategoryBtn');
const adminBtn = document.getElementById('adminBtn');

// State
let currentTasksSheetUrl = '';
let currentSheetName = '';
let currentUsername = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    scrollTabsLeft.addEventListener('click', () => {
        sheetTabs.scrollBy({ left: -TAB_SCROLL_STEP, behavior: 'smooth' });
    });
    scrollTabsRight.addEventListener('click', () => {
        sheetTabs.scrollBy({ left: TAB_SCROLL_STEP, behavior: 'smooth' });
    });
    sheetTabs.addEventListener('scroll', updateScrollButtons);
    settingsBtn.addEventListener('click', handleSettingsClick);
    deleteCategoryBtn.addEventListener('click', handleDeleteCategoryClick);

    // Settings menu modal
    document.getElementById('settingsCategoriesBtn').addEventListener('click', handleCategoriesClick);
    document.getElementById('settingsChangePasswordBtn').addEventListener('click', handleChangePasswordClick);
    document.getElementById('settingsCheckCreditBtn').addEventListener('click', handleCheckCreditClick);
    document.getElementById('settingsMenuCancelBtn').addEventListener('click', () => {
        document.getElementById('settingsMenuModal').classList.add('hidden');
    });
    document.getElementById('settingsMenuModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('settingsMenuModal')) {
            document.getElementById('settingsMenuModal').classList.add('hidden');
        }
    });

    // Change password modal
    document.getElementById('changePasswordOkBtn').addEventListener('click', handleChangePasswordOk);
    document.getElementById('changePasswordCancelBtn').addEventListener('click', () => {
        document.getElementById('changePasswordModal').classList.add('hidden');
    });
    document.getElementById('changePasswordModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('changePasswordModal')) {
            document.getElementById('changePasswordModal').classList.add('hidden');
        }
    });
    document.getElementById('confirmNewPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleChangePasswordOk();
    });

    // Credit modal
    document.getElementById('creditCloseBtn').addEventListener('click', () => {
        document.getElementById('creditModal').classList.add('hidden');
    });
    document.getElementById('creditModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('creditModal')) {
            document.getElementById('creditModal').classList.add('hidden');
        }
    });

    // Admin menu modal
    adminBtn.addEventListener('click', () => {
        document.getElementById('adminMenuModal').classList.remove('hidden');
    });
    document.getElementById('adminMenuCancelBtn').addEventListener('click', () => {
        document.getElementById('adminMenuModal').classList.add('hidden');
    });
    document.getElementById('adminMenuModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('adminMenuModal')) {
            document.getElementById('adminMenuModal').classList.add('hidden');
        }
    });
    document.getElementById('adminAddUserBtn').addEventListener('click', () => {
        document.getElementById('adminMenuModal').classList.add('hidden');
        document.getElementById('addUserUsername').value = '';
        document.getElementById('addUserPassword').value = '';
        document.getElementById('addUserCredit').value = '';
        document.getElementById('addUserNumber1').value = '';
        document.getElementById('addUserNumber2').value = '';
        document.getElementById('addUserError').textContent = '';
        document.getElementById('addUserOkBtn').disabled = false;
        document.getElementById('addUserModal').classList.remove('hidden');
        document.getElementById('addUserUsername').focus();
    });

    // Add user modal
    document.getElementById('addUserCancelBtn').addEventListener('click', () => {
        document.getElementById('addUserModal').classList.add('hidden');
    });
    document.getElementById('addUserModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('addUserModal')) {
            document.getElementById('addUserModal').classList.add('hidden');
        }
    });
    document.getElementById('addUserOkBtn').addEventListener('click', handleAddUserOk);
    document.getElementById('addUserPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleAddUserOk(); }
    });

    // Add user success modal
    document.getElementById('addUserSuccessCloseBtn').addEventListener('click', () => {
        document.getElementById('addUserSuccessModal').classList.add('hidden');
    });
    document.getElementById('addUserSuccessModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('addUserSuccessModal')) {
            document.getElementById('addUserSuccessModal').classList.add('hidden');
        }
    });
});

// [NEW FUNCTION] Load all sheet names from a tasks workbook
async function loadSheetMetadata(tasksSheetId) {
    const url = `/api/sheets/metadata?sheetId=${encodeURIComponent(tasksSheetId)}`;
    const response = await fetch(url, { headers: getAuthHeaders({}) });
    if (!response.ok) {
        throw new Error('Failed to load sheet metadata');
    }
    const data = await response.json();
    return (data.sheets || []).map(s => s.properties.title);
}

// [NEW FUNCTION] Load tasks from a specific sheet tab in a tasks workbook
async function loadTasksFromSheet(tasksSheetUrl, sheetName = 'Sheet1') {
    try {
        if (!tasksSheetUrl || tasksSheetUrl.trim() === '') {
            return [];
        }

        // Extract Sheet ID from URL
        const sheetIdMatch = tasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!sheetIdMatch) {
            console.error('Invalid tasks sheet URL format');
            return [];
        }

        const tasksSheetId = sheetIdMatch[1];
        // Properly quote sheet names for the Sheets API range notation
        const escapedSheetName = sheetName.replace(/'/g, "''");
        const quotedSheetName = /[^A-Za-z0-9]/.test(sheetName) ? `'${escapedSheetName}'` : escapedSheetName;
        const range = `${quotedSheetName}!A:B`; // Columns A (Tasks) and B (Notes)
        const url = `/api/sheets/values?sheetId=${encodeURIComponent(tasksSheetId)}&range=${encodeURIComponent(range)}`;

        const response = await fetch(url, { headers: getAuthHeaders({}) });
        
        if (!response.ok) {
            console.error('Failed to load tasks from sheet');
            return [];
        }

        const data = await response.json();
        const rows = data.values || [];

        // Filter rows where column A (task) is non-empty, return task+note objects with original row index
        return rows
            .map((row, index) => ({ task: row[0] || '', note: row[1] || '', rowIndex: index }))
            .filter(item => item.task.trim().length > 0);
    } catch (error) {
        console.error('Error loading tasks:', error);
        return [];
    }
}

// Update visibility of scroll buttons based on tab overflow
function updateScrollButtons() {
    const hasOverflow = sheetTabs.scrollWidth > sheetTabs.clientWidth;
    const atStart = sheetTabs.scrollLeft <= 0;
    const atEnd = sheetTabs.scrollLeft + sheetTabs.clientWidth >= sheetTabs.scrollWidth - 1; // -1 accounts for subpixel rounding
    scrollTabsLeft.classList.toggle('visible', hasOverflow && !atStart);
    scrollTabsRight.classList.toggle('visible', hasOverflow && !atEnd);
}

// [NEW FUNCTION] Create sheet tabs and load the first sheet's tasks
async function createSheetTabs(tasksSheetUrl) {
    currentTasksSheetUrl = tasksSheetUrl;
    sheetTabs.innerHTML = '';
    updateScrollButtons();

    const sheetIdMatch = tasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
        const tasks = await loadTasksFromSheet(tasksSheetUrl);
        currentSheetName = 'Sheet1';
        displayTasks(tasks);
        return;
    }

    const tasksSheetId = sheetIdMatch[1];
    let sheetNames;
    try {
        sheetNames = await loadSheetMetadata(tasksSheetId);
    } catch (e) {
        console.error('Could not load sheet metadata, falling back to Sheet1', e);
        sheetNames = ['Sheet1'];
    }

    if (sheetNames.length === 0) {
        sheetNames = ['Sheet1'];
    }

    // Skip the 'Settings' sheet from the tabs
    const filteredNames = sheetNames.filter(name => name !== 'Settings');

    if (filteredNames.length === 0) {
        tasksList.innerHTML = '';
        noTasks.textContent = 'No task sheets found. Use the Settings button below to view settings.';
        noTasks.style.display = 'block';
        updateScrollButtons();
        return;
    }

    filteredNames.forEach((name, index) => {
        const tab = document.createElement('button');
        tab.classList.add('sheet-tab');
        if (index === 0) tab.classList.add('active');
        tab.textContent = name;
        tab.addEventListener('click', () => switchToTab(tab, tasksSheetUrl, name));
        sheetTabs.appendChild(tab);
    });

    // Load tasks for the first sheet
    const firstTasks = await loadTasksFromSheet(tasksSheetUrl, filteredNames[0]);
    currentSheetName = filteredNames[0];
    displayTasks(firstTasks);
    updateScrollButtons();
}

// [NEW FUNCTION] Switch to a sheet tab
async function switchToTab(tabElement, tasksSheetUrl, sheetName) {
    // Update active tab styling
    sheetTabs.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');

    // Load tasks for the selected sheet
    const tasks = await loadTasksFromSheet(tasksSheetUrl, sheetName);
    currentSheetName = sheetName;
    displayTasks(tasks);
}

// [NEW FUNCTION] Load and display data from the 'Settings' sheet
async function handleSettingsClick() {
    if (!currentTasksSheetUrl) {
        return;
    }
    // Open the settings menu modal with three options
    const modal = document.getElementById('settingsMenuModal');
    modal.classList.remove('hidden');
}

// Load tasks and notes from the Settings sheet (Categories option)
async function handleCategoriesClick() {
    document.getElementById('settingsMenuModal').classList.add('hidden');
    if (!currentTasksSheetUrl) {
        return;
    }
    // Deselect all tabs to indicate we are viewing Settings
    sheetTabs.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));

    const tasks = await loadTasksFromSheet(currentTasksSheetUrl, 'Settings');
    currentSheetName = 'Settings';
    displayTasks(tasks);
}

// Open the change-password modal
function handleChangePasswordClick() {
    document.getElementById('settingsMenuModal').classList.add('hidden');
    const modal = document.getElementById('changePasswordModal');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmNewPassword').value = '';
    document.getElementById('changePasswordError').textContent = '';
    document.getElementById('changePasswordOkBtn').disabled = false;
    modal.classList.remove('hidden');
    document.getElementById('oldPassword').focus();
}

// Submit the change-password form
async function handleChangePasswordOk() {
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const errorEl = document.getElementById('changePasswordError');
    const okBtn = document.getElementById('changePasswordOkBtn');

    errorEl.textContent = '';

    if (!oldPassword) {
        errorEl.textContent = 'Please enter your old password.';
        document.getElementById('oldPassword').focus();
        return;
    }
    if (!newPassword) {
        errorEl.textContent = 'Please enter a new password.';
        document.getElementById('newPassword').focus();
        return;
    }
    if (newPassword !== confirmNewPassword) {
        errorEl.textContent = 'New passwords do not match.';
        document.getElementById('confirmNewPassword').focus();
        return;
    }

    okBtn.disabled = true;
    try {
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ oldPassword, newPassword }),
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || 'Failed to change password.';
            okBtn.disabled = false;
            return;
        }

        document.getElementById('changePasswordModal').classList.add('hidden');
    } catch {
        errorEl.textContent = 'Unable to connect to the server. Please try again.';
        okBtn.disabled = false;
    }
}

// Fetch and display the user's available credit
async function handleCheckCreditClick() {
    document.getElementById('settingsMenuModal').classList.add('hidden');
    const modal = document.getElementById('creditModal');
    const msgEl = document.getElementById('creditMessage');
    msgEl.textContent = 'Loading...';
    modal.classList.remove('hidden');

    try {
        const response = await fetch('/api/auth/credit', {
            headers: getAuthHeaders(),
        });

        const data = await response.json();

        if (!response.ok) {
            msgEl.textContent = data.error || 'Failed to load credit.';
            return;
        }

        const credit = data.credit !== undefined && data.credit !== '' ? data.credit : '0';
        msgEl.textContent = `Available credit is ${credit} texts`;
    } catch {
        msgEl.textContent = 'Unable to connect to the server. Please try again.';
    }
}

// [NEW FUNCTION] Delete the currently open category and all its tasks
async function handleDeleteCategoryClick() {
    if (!currentTasksSheetUrl || !currentSheetName || currentSheetName === 'Settings') {
        return;
    }

    if (currentSheetName.toUpperCase() === 'GENERAL') {
        await showInfo(`The "${currentSheetName}" category cannot be deleted.`, 'Cannot delete');
        return;
    }

    const confirmed = await showConfirmDelete(
        `Are you sure you want to delete the category "${currentSheetName}" and all its tasks? This cannot be undone.`
    );
    if (!confirmed) return;

    const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) return;
    const sheetId = sheetIdMatch[1];

    try {
        const response = await fetch('/api/sheets/delete-sheet', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sheetId, sheetName: currentSheetName }),
        });

        if (!response.ok) {
            let errMsg = `Server responded with status ${response.status}.`;
            try {
                const data = await response.json();
                errMsg = data.error || errMsg;
            } catch (_) { /* ignore */ }
            alert('Failed to delete category: ' + errMsg);
            return;
        }

        // Reload the tabs, showing the first available category
        await createSheetTabs(currentTasksSheetUrl);
    } catch (err) {
        console.error('Error deleting category:', err);
        alert('Failed to delete category. Please try again.');
    }
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    
    // Validation
    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }

    // Show loading state
    showLoading(true);
    clearError();

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'Login failed. Please check your credentials.');
            showLoading(false);
            return;
        }

        // Store the session token (cleared on tab close)
        sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);

        // Proceed to the tasks page
        await loginSuccess(username, data.tasksSheetUrl, data.isAdmin === true, parseFloat(data.credit) || 0);
    } catch {
        showError('Unable to connect to the server. Please try again.');
    } finally {
        showLoading(false);
    }
}

// Login successful
async function loginSuccess(username, tasksSheetUrl, isAdmin = false, credit = 0) {
    // Update welcome message
    welcomeUsername.textContent = username;
    currentUsername = username;

    // Show or hide the admin button based on role
    if (isAdmin) {
        adminBtn.classList.remove('hidden');
    } else {
        adminBtn.classList.add('hidden');
    }

    // Show low-balance warning if credit is below 25
    const lowBalanceWarning = document.getElementById('lowBalanceWarning');
    if (credit < 25) {
        lowBalanceWarning.classList.remove('hidden');
    } else {
        lowBalanceWarning.classList.add('hidden');
    }

    // Switch pages first so tabs/tasks are visible when loaded
    loginPage.classList.remove('active');
    tasksPage.classList.add('active');

    // Clear form
    usernameInput.value = '';
    passwordInput.value = '';

    // Build sheet tabs and display tasks
    await createSheetTabs(tasksSheetUrl);
}

// Handle add user (admin only)
async function handleAddUserOk() {
    const username = document.getElementById('addUserUsername').value.trim();
    const password = document.getElementById('addUserPassword').value;
    const credit = document.getElementById('addUserCredit').value.trim();
    const number1 = document.getElementById('addUserNumber1').value.trim();
    const number2 = document.getElementById('addUserNumber2').value.trim();
    const addUserError = document.getElementById('addUserError');
    const addUserOkBtn = document.getElementById('addUserOkBtn');

    if (!username) {
        addUserError.textContent = 'Please enter a username.';
        document.getElementById('addUserUsername').focus();
        return;
    }
    if (!password) {
        addUserError.textContent = 'Please enter a password.';
        document.getElementById('addUserPassword').focus();
        return;
    }
    if (password.length < 6) {
        addUserError.textContent = 'Password must be at least 6 characters.';
        document.getElementById('addUserPassword').focus();
        return;
    }
    if (credit === '') {
        addUserError.textContent = 'Please enter a credit amount.';
        document.getElementById('addUserCredit').focus();
        return;
    }
    if (Number.isNaN(Number(credit))) {
        addUserError.textContent = 'Credit must be a valid number.';
        document.getElementById('addUserCredit').focus();
        return;
    }
    if (number1 === '') {
        addUserError.textContent = 'Please enter Number 1.';
        document.getElementById('addUserNumber1').focus();
        return;
    }
    if (Number.isNaN(Number(number1))) {
        addUserError.textContent = 'Number 1 must be a valid number.';
        document.getElementById('addUserNumber1').focus();
        return;
    }
    if (number2 !== '' && Number.isNaN(Number(number2))) {
        addUserError.textContent = 'Number 2 must be a valid number.';
        document.getElementById('addUserNumber2').focus();
        return;
    }

    addUserOkBtn.disabled = true;
    addUserError.textContent = '';

    try {
        const response = await fetch('/api/admin/add-user', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ username, password, credit, number1, number2 }),
        });

        const data = await response.json();

        if (!response.ok) {
            addUserError.textContent = data.error || 'Failed to add user.';
            addUserOkBtn.disabled = false;
            return;
        }

        document.getElementById('addUserModal').classList.add('hidden');

        // Show styled success modal with workbook details.
        const workbookId = data.workbookId || '';
        const workbookUrl = data.workbookUrl || `https://docs.google.com/spreadsheets/d/${workbookId}`;
        document.getElementById('addUserWorkbookId').textContent = workbookId;
        const link = document.getElementById('addUserWorkbookLink');
        link.href = workbookUrl;
        document.getElementById('addUserSuccessModal').classList.remove('hidden');
    } catch {
        addUserError.textContent = 'Unable to connect to the server. Please try again.';
        addUserOkBtn.disabled = false;
    }
}

// Display tasks
function displayTasks(taskRows) {
    tasksList.innerHTML = '';
    noTasks.textContent = 'No tasks assigned yet';

    if (!taskRows || taskRows.length === 0) {
        noTasks.style.display = 'block';
        return;
    }

    noTasks.style.display = 'none';

    taskRows.forEach(({ task, note, rowIndex }, index) => {
        const taskItem = document.createElement('div');
        taskItem.className = 'task-item';
        taskItem.style.animation = `slideIn 0.3s ease-out ${index * 0.1}s both`;

        const taskRow = document.createElement('div');
        taskRow.className = 'task-row';

        const taskBox = document.createElement('div');
        taskBox.className = 'task-box';
        taskBox.innerHTML = `<strong>${index + 1}.</strong> ${escapeHtml(task)}`;

        taskRow.appendChild(taskBox);

        if (note) {
            const noteBox = document.createElement('div');
            noteBox.className = 'note-box';
            noteBox.textContent = note;
            taskRow.appendChild(noteBox);
        }

        const isSettingsView = currentSheetName === 'Settings';

        if (!isSettingsView) {
            const moveUpBtn = document.createElement('button');
            moveUpBtn.className = 'btn-move-task-up';
            moveUpBtn.innerHTML = '&#8679;';
            moveUpBtn.title = 'Move task up';
            moveUpBtn.disabled = index === 0;
            moveUpBtn.addEventListener('click', () => moveTask(rowIndex, 'up'));
            taskRow.appendChild(moveUpBtn);

            const moveDownBtn = document.createElement('button');
            moveDownBtn.className = 'btn-move-task-down';
            moveDownBtn.innerHTML = '&#8681;';
            moveDownBtn.title = 'Move task down';
            moveDownBtn.disabled = index === taskRows.length - 1;
            moveDownBtn.addEventListener('click', () => moveTask(rowIndex, 'down'));
            taskRow.appendChild(moveDownBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-task';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = 'Edit task';
        editBtn.addEventListener('click', () => openEditTaskModal(task, note, rowIndex));
        taskRow.appendChild(editBtn);

        if (!isSettingsView) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-task';
            deleteBtn.innerHTML = '&#10005;';
            deleteBtn.title = 'Delete this task';
            deleteBtn.addEventListener('click', () => deleteTask(rowIndex));
            taskRow.appendChild(deleteBtn);
        }

        taskItem.appendChild(taskRow);
        tasksList.appendChild(taskItem);
    });
}

// Open the edit task modal pre-populated with the task's current values
async function openEditTaskModal(task, note, rowIndex) {
    if (!currentTasksSheetUrl) return;

    const editTaskModal = document.getElementById('editTaskModal');
    const editTaskSheet = document.getElementById('editTaskSheet');
    const editTaskText = document.getElementById('editTaskText');
    const editTaskNotes = document.getElementById('editTaskNotes');
    const editTaskError = document.getElementById('editTaskError');
    const editTaskOkBtn = document.getElementById('editTaskOkBtn');

    const isSettingsView = currentSheetName === 'Settings';

    // Show/hide the category dropdown row and update labels based on context
    const sheetFormGroup = editTaskSheet.closest('.form-group');
    const editTaskTextLabel = editTaskText.closest('.form-group') && editTaskText.closest('.form-group').querySelector('label');
    const editTaskNotesLabel = editTaskNotes.closest('.form-group') && editTaskNotes.closest('.form-group').querySelector('label');
    const modalTitle = editTaskModal.querySelector('h2');

    if (isSettingsView) {
        if (sheetFormGroup) sheetFormGroup.style.display = 'none';
        if (modalTitle) modalTitle.textContent = 'Edit Category';
        if (editTaskTextLabel) editTaskTextLabel.textContent = 'Category Name';
        if (editTaskNotesLabel) editTaskNotesLabel.textContent = 'Category Key';
    } else {
        if (sheetFormGroup) sheetFormGroup.style.display = '';
        if (modalTitle) modalTitle.textContent = 'Edit Task';
        if (editTaskTextLabel) editTaskTextLabel.textContent = 'Task';
        if (editTaskNotesLabel) editTaskNotesLabel.textContent = 'Notes';

        // Populate category dropdown
        editTaskSheet.innerHTML = '';
        try {
            const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (sheetIdMatch) {
                const sheetNames = await loadSheetMetadata(sheetIdMatch[1]);
                const filtered = sheetNames.filter(name => name !== 'Settings');
                filtered.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    if (name === currentSheetName) opt.selected = true;
                    editTaskSheet.appendChild(opt);
                });
            }
        } catch (err) {
            // Leave dropdown with just the current sheet as fallback
            console.warn('Failed to load categories for edit modal:', err);
            const opt = document.createElement('option');
            opt.value = currentSheetName;
            opt.textContent = currentSheetName;
            opt.selected = true;
            editTaskSheet.appendChild(opt);
        }
    }

    editTaskText.value = task;
    editTaskNotes.value = note;
    editTaskError.textContent = '';
    editTaskOkBtn.disabled = false;

    // Store the original values on the modal for use in the OK handler
    editTaskModal.dataset.originalSheet = currentSheetName;
    editTaskModal.dataset.originalTask = task;
    editTaskModal.dataset.rowIndex = rowIndex;

    editTaskModal.classList.remove('hidden');
    editTaskText.focus();
}

// Show a simple informational/warning dialog and return a Promise that resolves when dismissed
function showInfo(message, title) {
    return new Promise((resolve) => {
        const modal = document.getElementById('infoModal');
        const okBtn = document.getElementById('infoModalOkBtn');
        const msgEl = document.getElementById('infoModalMessage');
        const titleEl = document.getElementById('infoModalTitle');

        if (!modal || !okBtn) { resolve(); return; }

        if (msgEl) msgEl.textContent = message || '';
        if (titleEl) titleEl.textContent = title || 'Notice';

        function cleanup() {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', cleanup);
            modal.removeEventListener('click', onOverlay);
            resolve();
        }

        function onOverlay(e) { if (e.target === modal) cleanup(); }

        okBtn.addEventListener('click', cleanup);
        modal.addEventListener('click', onOverlay);

        modal.classList.remove('hidden');
    });
}

// Show a custom confirmation dialog for delete and return a Promise<boolean>
// An optional message overrides the default text shown in the dialog.
function showConfirmDelete(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmDeleteModal');
        const okBtn = document.getElementById('confirmDeleteOkBtn');
        const cancelBtn = document.getElementById('confirmDeleteCancelBtn');
        const msgEl = document.getElementById('confirmDeleteMessage');

        const originalMessage = msgEl ? msgEl.textContent : '';
        if (message && msgEl) msgEl.textContent = message;

        function cleanup(result) {
            modal.classList.add('hidden');
            if (msgEl) msgEl.textContent = originalMessage;
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlay);
            resolve(result);
        }

        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onOverlay(e) { if (e.target === modal) cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onOverlay);

        modal.classList.remove('hidden');
    });
}

// Delete a task row from the current sheet
async function deleteTask(rowIndex) {
    const confirmed = await showConfirmDelete();
    if (!confirmed) return;

    const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) return;
    const sheetId = sheetIdMatch[1];

    try {
        const response = await fetch('/api/sheets/delete-row', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sheetId, sheetName: currentSheetName, rowIndex }),
        });

        if (!response.ok) {
            const data = await response.json();
            alert('Failed to delete task: ' + (data.error || 'Unknown error'));
            return;
        }

        // Reload tasks for the current sheet without prompting a new login
        const tasks = await loadTasksFromSheet(currentTasksSheetUrl, currentSheetName);
        displayTasks(tasks);
    } catch (error) {
        console.error('Error deleting task:', error);
        alert('Failed to delete task. Please try again.');
    }
}

// Move a task row one position up or down within the current sheet
async function moveTask(rowIndex, direction) {
    const sheetIdMatch = currentTasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) return;
    const sheetId = sheetIdMatch[1];

    try {
        const response = await fetch('/api/sheets/move-row', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sheetId, sheetName: currentSheetName, rowIndex, direction }),
        });

        if (!response.ok) {
            const data = await response.json();
            alert('Failed to move task: ' + (data.error || 'Unknown error'));
            return;
        }

        // Reload tasks for the current sheet
        const tasks = await loadTasksFromSheet(currentTasksSheetUrl, currentSheetName);
        displayTasks(tasks);
    } catch (error) {
        console.error('Error moving task:', error);
        alert('Failed to move task. Please try again.');
    }
}

// Handle logout
function handleLogout() {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    currentUsername = '';
    adminBtn.classList.add('hidden');
    tasksPage.classList.remove('active');
    loginPage.classList.add('active');
    usernameInput.focus();
}

// Utility functions
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
}

function clearError() {
    errorMessage.textContent = '';
    errorMessage.classList.remove('show');
}

function showLoading(show) {
    if (show) {
        loadingSpinner.classList.remove('hidden');
    } else {
        loadingSpinner.classList.add('hidden');
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
