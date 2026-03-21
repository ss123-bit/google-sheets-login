// functions/api/auth/add-user.js
// POST /api/auth/add-user
// Body: { username, password, tasksSheetUrl? }
//
// Adds a new user to the users spreadsheet.
// Only authenticated users with role 'admin' (column H) may call this endpoint.
//
// Required environment variables:
//   APP_AUTH_SECRET       – shared HMAC secret for session validation
//   APP_SHEET_ID          – spreadsheet ID (comma-separated; first value used as users sheet)
//   APP_USERS_SHEET_ID    – (optional) overrides the users spreadsheet ID
//   APP_USERS_SHEET_RANGE – (optional) range of users data, defaults to Sheet1!B:H

import {
    getGoogleAccessToken,
    getCorsHeaders,
    jsonResponse,
    errorResponse,
    checkAuth,
    getUsernameFromToken,
    generatePbkdf2Hash,
} from '../../_shared.js';

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
    const cors = getCorsHeaders(request, env);

    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    const callerUsername = getUsernameFromToken(request);
    if (!callerUsername) {
        return errorResponse('Unauthorized', 401, cors);
    }

    // --- Resolve users spreadsheet ---
    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('APP_SHEET_ID is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();
    const usersRange = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:H').trim();

    // --- Fetch Google access token ---
    let accessToken;
    try {
        accessToken = await getGoogleAccessToken(env);
    } catch {
        console.error('Failed to obtain Google access token');
        return errorResponse('Authentication service unavailable.', 503, cors);
    }

    // --- Read users sheet to verify caller is admin ---
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

    const callerRow = rows.slice(1).find((r) => (r[0] || '').trim() === callerUsername.trim());
    if (!callerRow) {
        return errorResponse('Unauthorized', 401, cors);
    }
    const callerRole = (callerRow[6] || '').trim().toLowerCase();
    if (callerRole !== 'admin') {
        return errorResponse('Forbidden: admin access required.', 403, cors);
    }

    // --- Parse body ---
    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid request body.', 400, cors);
    }

    const { username, password, tasksSheetUrl = '' } = body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return errorResponse('username and password are required.', 400, cors);
    }

    if (username.trim().length === 0) {
        return errorResponse('username must not be empty.', 400, cors);
    }

    if (password.length < 1) {
        return errorResponse('password must not be empty.', 400, cors);
    }

    // --- Check for duplicate username (case-insensitive) ---
    const duplicate = rows.slice(1).find(
        (r) => (r[0] || '').trim().toLowerCase() === username.trim().toLowerCase()
    );
    if (duplicate) {
        return errorResponse('Username already exists.', 409, cors);
    }

    // --- Hash the password ---
    let hashedPassword;
    try {
        hashedPassword = await generatePbkdf2Hash(password);
    } catch {
        console.error('Failed to hash password');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // --- Append new user row to the sheet ---
    // Derive the sheet name and start column from usersRange (e.g. "Sheet1!B:H")
    const rangeMatch = usersRange.match(/^(.+?)!([A-Za-z]+)/);
    const sheetName = rangeMatch ? rangeMatch[1] : 'Sheet1';
    const startCol = rangeMatch ? rangeMatch[2].toUpperCase() : 'B';
    const appendRange = `${sheetName}!${startCol}:${startCol}`;

    // Row layout mirrors the users sheet columns B-H:
    // B=username, C=hashedPassword, D=tasksSheetUrl, E-G=empty, H=role (empty for regular users)
    const newRow = [username.trim(), hashedPassword, (tasksSheetUrl || '').trim(), '', '', '', ''];

    try {
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW`;
        const res = await fetch(appendUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                range: appendRange,
                majorDimension: 'ROWS',
                values: [newRow],
            }),
        });

        if (!res.ok) {
            console.error('Sheets API error appending user:', res.status);
            return errorResponse('Failed to add user.', 500, cors);
        }
    } catch {
        console.error('Network error appending user to Sheets');
        return errorResponse('Failed to add user.', 503, cors);
    }

    return jsonResponse({ success: true }, 200, cors);
}
