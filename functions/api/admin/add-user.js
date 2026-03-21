// functions/api/admin/add-user.js
// POST /api/admin/add-user
// Body: { username, password, tasksSheetUrl? }
//
// Creates a new user in the users spreadsheet.
// Only users whose row in column H contains "admin" may call this endpoint.
//
// The new user is appended as a new row with columns:
//   B: Username | C: PBKDF2 password hash | D: TasksSheetUrl (optional)
// Column H (role) is left blank, making the new user a non-admin by default.
//
// Requires the same environment variables as login.js.

import {
    getGoogleAccessToken,
    getCorsHeaders,
    jsonResponse,
    errorResponse,
    checkAuth,
    getUsernameFromToken,
    generatePbkdf2Hash,
    sanitizeValue,
} from '../../_shared.js';

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
    const cors = getCorsHeaders(request, env);

    // --- Require authentication ---
    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    const requestingUser = getUsernameFromToken(request);
    if (!requestingUser) {
        return errorResponse('Unauthorized', 401, cors);
    }

    // --- Validate env ---
    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('APP_SHEET_ID is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();
    const usersRange = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:H').trim();

    // --- Parse body ---
    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid request body.', 400, cors);
    }

    const { username, password, tasksSheetUrl } = body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return errorResponse('username and password are required.', 400, cors);
    }
    if (username.trim().length === 0) {
        return errorResponse('username cannot be empty.', 400, cors);
    }
    if (password.length < 6) {
        return errorResponse('password must be at least 6 characters.', 400, cors);
    }

    // --- Fetch users to verify requesting user is admin and check for duplicates ---
    let token;
    try {
        token = await getGoogleAccessToken(env);
    } catch {
        console.error('Failed to obtain Google access token');
        return errorResponse('Authentication service unavailable.', 503, cors);
    }

    let rows;
    try {
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(usersRange)}`;
        const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            console.error('Sheets API error fetching users');
            return errorResponse('Service unavailable.', 503, cors);
        }
        const data = await res.json();
        rows = data.values || [];
    } catch {
        console.error('Network error fetching users');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // Verify the requesting user has admin role (column H = index 6).
    const requesterRow = rows.slice(1).find((r) => (r[0] || '').trim() === requestingUser.trim());
    if (!requesterRow || (requesterRow[6] || '').trim().toLowerCase() !== 'admin') {
        return errorResponse('Forbidden: admin access required.', 403, cors);
    }

    // Check the new username is not already taken.
    const duplicate = rows.slice(1).find((r) => (r[0] || '').trim().toLowerCase() === username.trim().toLowerCase());
    if (duplicate) {
        return errorResponse('Username already exists.', 409, cors);
    }

    // --- Hash the password ---
    let passwordHash;
    try {
        passwordHash = await generatePbkdf2Hash(password);
    } catch {
        console.error('Failed to hash password');
        return errorResponse('Server error.', 500, cors);
    }

    // --- Append new user row ---
    // Extract sheet name and start column from range to build the append range.
    const sheetNameMatch = usersRange.match(/^(.+?)!/);
    const sheetName = sheetNameMatch ? sheetNameMatch[1] : 'Sheet1';
    const appendRange = `${sheetName}!B:D`;

    const newRow = [
        sanitizeValue(username.trim()),
        passwordHash,
        sanitizeValue((tasksSheetUrl || '').trim()),
    ];

    try {
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
        const appendRes = await fetch(appendUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [newRow] }),
        });
        if (!appendRes.ok) {
            console.error('Sheets API error appending user');
            return errorResponse('Failed to create user.', 503, cors);
        }
    } catch {
        console.error('Network error appending user');
        return errorResponse('Failed to create user.', 503, cors);
    }

    return jsonResponse({ success: true }, 200, cors);
}
