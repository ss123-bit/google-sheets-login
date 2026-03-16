// functions/api/auth/change-password.js
// POST /api/auth/change-password
// Body: { oldPassword, newPassword }
//
// Changes the password for the currently authenticated user.
// - Validates the old password against the users spreadsheet.
// - If valid, writes a new PBKDF2 hash into the password column for that user.
//
// Assumptions about the users spreadsheet layout (matching login.js defaults):
//   Column B (index 0) – Username
//   Column C (index 1) – Password
//   Column D (index 2) – TasksSheetUrl
// The first row is a header row.

import {
    getGoogleAccessToken,
    getCorsHeaders,
    jsonResponse,
    errorResponse,
    checkAuth,
    getUsernameFromToken,
    verifyPassword,
    generatePbkdf2Hash,
} from '../../_shared.js';

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

function colLetterToNum(col) {
    let num = 0;
    for (const ch of col.toUpperCase()) {
        num = num * 26 + (ch.charCodeAt(0) - 64);
    }
    return num;
}

function colNumToLetter(num) {
    let result = '';
    while (num > 0) {
        const rem = (num - 1) % 26;
        result = String.fromCharCode(65 + rem) + result;
        num = Math.floor((num - 1) / 26);
    }
    return result;
}

/**
 * Given the APP_USERS_SHEET_RANGE (e.g. "Sheet1!B:D") and the 0-based row
 * index of the user in the returned rows array, returns the A1 notation of
 * the password cell (e.g. "Sheet1!C3").
 */
function computePasswordCell(usersRange, userRowIndex) {
    // Extract sheet name and start column/row from the range.
    const match = usersRange.match(/^(.+?)!([A-Za-z]+)(\d*)/);
    const sheetName = match ? match[1] : 'Sheet1';
    const startCol   = match ? match[2].toUpperCase() : 'B';
    const startRow   = match && match[3] ? parseInt(match[3], 10) : 1;

    // Password column = start column + 1 (username is at start column).
    const passwordColLetter = colNumToLetter(colLetterToNum(startCol) + 1);
    const sheetRow = startRow + userRowIndex;
    return `${sheetName}!${passwordColLetter}${sheetRow}`;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
    const cors = getCorsHeaders(request, env);

    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    const username = getUsernameFromToken(request);
    if (!username) {
        return errorResponse('Unauthorized', 401, cors);
    }

    // --- Parse body ---
    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid request body.', 400, cors);
    }

    const { oldPassword, newPassword } = body || {};
    if (!oldPassword || !newPassword || typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
        return errorResponse('oldPassword and newPassword are required.', 400, cors);
    }

    if (newPassword.length < 1) {
        return errorResponse('New password must not be empty.', 400, cors);
    }

    // --- Resolve users spreadsheet ---
    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('APP_SHEET_ID is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();
    const usersRange   = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:D').trim();

    // --- Fetch Google access token ---
    let accessToken;
    try {
        accessToken = await getGoogleAccessToken(env);
    } catch {
        console.error('Failed to obtain Google access token');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // --- Read users sheet ---
    let rows;
    try {
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(usersRange)}`;
        const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
            console.error('Sheets API error fetching users');
            return errorResponse('Service unavailable.', 503, cors);
        }
        const data = await res.json();
        rows = data.values || [];
    } catch {
        console.error('Network error fetching users from Sheets');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // --- Find the user row (includes header at index 0) ---
    const userRowIndex = rows.findIndex((r) => (r[0] || '').trim() === username.trim());
    if (userRowIndex === -1) {
        return errorResponse('User not found.', 404, cors);
    }

    const storedPassword = rows[userRowIndex][1] || '';

    // --- Verify old password ---
    const { ok } = await verifyPassword(oldPassword, storedPassword);
    if (!ok) {
        return errorResponse('Old password is incorrect.', 401, cors);
    }

    // --- Generate new PBKDF2 hash ---
    let newHash;
    try {
        newHash = await generatePbkdf2Hash(newPassword);
    } catch {
        console.error('Failed to hash new password');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // --- Update password cell in the spreadsheet ---
    const passwordCell = computePasswordCell(usersRange, userRowIndex);

    try {
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(passwordCell)}?valueInputOption=RAW`;
        const res = await fetch(updateUrl, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                range: passwordCell,
                majorDimension: 'ROWS',
                values: [[newHash]],
            }),
        });

        if (!res.ok) {
            console.error('Sheets API error updating password:', res.status);
            return errorResponse('Failed to update password.', 500, cors);
        }
    } catch {
        console.error('Network error updating password in Sheets');
        return errorResponse('Failed to update password.', 503, cors);
    }

    return jsonResponse({ success: true }, 200, cors);
}
