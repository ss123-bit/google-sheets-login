// Configuration - UPDATE THESE VALUES
const CONFIG = {
    SHEET_ID: '1V4CU3ONpLEURsoJHrwUZWJYhX8827I7yn5vhHTH3rwE',
    // Get this from: https://docs.google.com/spreadsheets/d/SHEET_ID/edit
    // Copy the SHEET_ID part from the URL
    API_KEY: 'AIzaSyCIqWMa3w7UasetnEDJzyq3-zGA19sfLS0'
    // Get from: https://console.cloud.google.com/apis/credentials
};

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

// State
let usersData = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    loadUsersData();
});

// Load users data from Google Sheets
async function loadUsersData() {
    try {
        const range = 'Sheet1!B:D'; // Columns B, C, D (Username, Password, Tasks Sheet URL) [CHANGED]
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${range}?key=${CONFIG.API_KEY}`;

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to load user data. Check your Sheet ID and API Key.');
        }

        const data = await response.json();
        const rows = data.values || [];

        // Skip header row and parse data
        usersData = rows.slice(1).map(row => ({
            username: row[0] || '',
            password: row[1] || '',
            tasksSheetUrl: row[2] || '' // [CHANGED: was 'tasks']
        }));
        console.log('Loaded users:', usersData);
        console.log('User data loaded successfully');
    } catch (error) {
        console.error('Error loading data:', error);
        showError('Failed to connect to Google Sheets. Please check your configuration.');
    }
}

// [NEW FUNCTION] Load all sheet names from a tasks workbook
async function loadSheetMetadata(tasksSheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${tasksSheetId}?key=${CONFIG.API_KEY}`;
    const response = await fetch(url);
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
            return '';
        }

        // Extract Sheet ID from URL
        const sheetIdMatch = tasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!sheetIdMatch) {
            console.error('Invalid tasks sheet URL format');
            return '';
        }

        const tasksSheetId = sheetIdMatch[1];
        // Properly quote sheet names for the Sheets API range notation
        const escapedSheetName = sheetName.replace(/'/g, "''");
        const quotedSheetName = /[^A-Za-z0-9]/.test(sheetName) ? `'${escapedSheetName}'` : escapedSheetName;
        const range = `${encodeURIComponent(quotedSheetName + '!A:A')}`; // Column A (Tasks)
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${tasksSheetId}/values/${range}?key=${CONFIG.API_KEY}`;

        const response = await fetch(url);
        
        if (!response.ok) {
            console.error('Failed to load tasks from sheet');
            return '';
        }

        const data = await response.json();
        const rows = data.values || [];

        // Skip header row and join tasks with newlines
        const tasks = rows.slice(1).map(row => row[0] || '').filter(task => task.length > 0);
        return tasks.join('\n');
    } catch (error) {
        console.error('Error loading tasks:', error);
        return '';
    }
}

// [NEW FUNCTION] Create sheet tabs and load the first sheet's tasks
async function createSheetTabs(tasksSheetUrl) {
    sheetTabs.innerHTML = '';

    const sheetIdMatch = tasksSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
        const tasks = await loadTasksFromSheet(tasksSheetUrl);
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

    sheetNames.forEach((name, index) => {
        const tab = document.createElement('button');
        tab.classList.add('sheet-tab');
        if (index === 0) tab.classList.add('active');
        tab.textContent = name;
        tab.addEventListener('click', () => switchToTab(tab, tasksSheetUrl, name));
        sheetTabs.appendChild(tab);
    });

    // Load tasks for the first sheet
    const firstTasks = await loadTasksFromSheet(tasksSheetUrl, sheetNames[0]);
    displayTasks(firstTasks);
}

// [NEW FUNCTION] Switch to a sheet tab
async function switchToTab(tabElement, tasksSheetUrl, sheetName) {
    // Update active tab styling
    sheetTabs.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');

    // Load tasks for the selected sheet
    const tasks = await loadTasksFromSheet(tasksSheetUrl, sheetName);
    displayTasks(tasks);
}

// Handle login
async function handleLogin(e) { // [CHANGED: added 'async']
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

    // Simulate API delay
    setTimeout(async () => { // [CHANGED: added 'async']
        const user = usersData.find(u => u.username === username);

        if (!user) {
            showError('Username not found');
            showLoading(false);
            return;
        }

        if (user.password !== password) {
            showError('Incorrect password');
            showLoading(false);
            return;
        }

        // [NEW] Load tasks from the separate sheet with multi-tab support
        await loginSuccess(username, user.tasksSheetUrl); // [CHANGED: use createSheetTabs]
        showLoading(false);
    }, 500);
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
function displayTasks(taskString) {
    tasksList.innerHTML = '';

    if (!taskString || taskString.trim() === '') {
        noTasks.style.display = 'block';
        return;
    }

    noTasks.style.display = 'none';

    // Parse tasks (separated by newlines since each task is in its own cell) [CHANGED]
    const tasks = taskString
        .split(/\n+/)  // [CHANGED: was '/[,;|\n]+/']
        .map(task => task.trim())
        .filter(task => task.length > 0);

    if (tasks.length === 0) {
        noTasks.style.display = 'block';
        return;
    }

    tasks.forEach((task, index) => {
        const taskItem = document.createElement('div');
        taskItem.className = 'task-item';
        taskItem.style.animation = `slideIn 0.3s ease-out ${index * 0.1}s both`;
        
        const taskText = document.createElement('p');
        taskText.innerHTML = `<strong>${index + 1}.</strong> ${escapeHtml(task)}`;
        
        taskItem.appendChild(taskText);
        tasksList.appendChild(taskItem);
    });
}

// Handle logout
function handleLogout() {
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
