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

// State
let currentTasksSheetUrl = '';
let currentSheetName = '';

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
    // Deselect all tabs to indicate we are viewing Settings
    sheetTabs.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));

    const tasks = await loadTasksFromSheet(currentTasksSheetUrl, 'Settings');
    currentSheetName = 'Settings';
    displayTasks(tasks);
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
        await loginSuccess(username, data.tasksSheetUrl);
    } catch {
        showError('Unable to connect to the server. Please try again.');
    } finally {
        showLoading(false);
    }
}

// Login successful
async function loginSuccess(username, tasksSheetUrl) {
    // Update welcome message
    welcomeUsername.textContent = username;

    // Switch pages first so tabs/tasks are visible when loaded
    loginPage.classList.remove('active');
    tasksPage.classList.add('active');

    // Clear form
    usernameInput.value = '';
    passwordInput.value = '';

    // Build sheet tabs and display tasks
    await createSheetTabs(tasksSheetUrl);
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

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-task';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = 'Edit task';
        editBtn.addEventListener('click', () => openEditTaskModal(task, note, rowIndex));
        taskRow.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete-task';
        deleteBtn.innerHTML = '&#10005;';
        deleteBtn.title = 'Delete this task';
        deleteBtn.addEventListener('click', () => deleteTask(rowIndex));
        taskRow.appendChild(deleteBtn);

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

    editTaskText.value = task;
    editTaskNotes.value = note;
    editTaskError.textContent = '';
    editTaskOkBtn.disabled = false;

    // Store the original values on the modal for use in the OK handler
    editTaskModal.dataset.originalSheet = currentSheetName;
    editTaskModal.dataset.rowIndex = rowIndex;

    editTaskModal.classList.remove('hidden');
    editTaskText.focus();
}

// Delete a task row from the current sheet
async function deleteTask(rowIndex) {
    if (!confirm('Are you sure you want to delete this task and its notes?')) return;

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

// Handle logout
function handleLogout() {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
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
