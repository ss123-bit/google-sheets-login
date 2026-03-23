// functions/api/admin/add-user.js
// POST /api/admin/add-user
// Body: { username, password, credit, number1, number2? }
//
// Creates a new user in the users spreadsheet and provisions a new Google
// Sheets workbook for the user (named after the username).
//
// Only users whose row in column H contains "admin" may call this endpoint.
//
// Steps performed:
//   1. Validate the requesting user is an admin.
//   2. Create a new Google Sheets workbook titled after the new username,
//      with two sheets: "GENERAL" and "Settings".
//   3. Share the workbook with the service account as editor (Drive API).
//   4. Append a new row to the users sheet with columns:
//        B: Username | C: PBKDF2 password hash | D: Credit
//        E: Number 1  | F: Number 2 (optional)  | G: Workbook ID
//      Column H (role) is left blank, making the new user a non-admin.
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

    const { username, password, credit, number1, number2 } = body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return errorResponse('username and password are required.', 400, cors);
    }
    if (username.trim().length === 0) {
        return errorResponse('username cannot be empty.', 400, cors);
    }
    if (password.length < 6) {
        return errorResponse('password must be at least 6 characters.', 400, cors);
    }
    if (credit === undefined || credit === null || credit === '') {
        return errorResponse('credit is required.', 400, cors);
    }
    if (Number.isNaN(Number(credit))) {
        return errorResponse('credit must be a valid number.', 400, cors);
    }
    if (number1 === undefined || number1 === null || number1 === '') {
        return errorResponse('number1 is required.', 400, cors);
    }
    if (Number.isNaN(Number(number1))) {
        return errorResponse('number1 must be a valid number.', 400, cors);
    }
    if (number2 !== undefined && number2 !== null && number2 !== '' && Number.isNaN(Number(number2))) {
        return errorResponse('number2 must be a valid number.', 400, cors);
    }

    // --- Fetch users to verify requesting user is admin and check for duplicates ---
    let token;
    try {
        // Request both Sheets and Drive scopes so we can create and share the
        // new workbook in the same token request.
        token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/drive');
        // DEBUG: verify what scopes Google issued for this token
try {
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    const infoText = await infoRes.text();
    console.log('tokeninfo status:', infoRes.status);
    console.log('tokeninfo body:', infoText);

    // If it's JSON, pull scopes in a readable way:
    try {
        const info = JSON.parse(infoText);
        console.log('tokeninfo scope:', info.scope);
    } catch {
        // tokeninfo sometimes returns non-JSON on errors; already logged above.
    }
} catch (e) {
    console.warn('tokeninfo fetch failed:', String(e));
}
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

    // --- Create a new Google Sheets workbook for the user ---
    // The workbook is titled after the username and pre-provisioned with two
    // sheets: "GENERAL" (the default working sheet) and "Settings".
    let newSpreadsheetId;
    try {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                properties: { title: username.trim() },
                sheets: [
                    { properties: { title: 'GENERAL', sheetId: 0 } },
                    { properties: { title: 'Settings', sheetId: 1 } },
                ],
            }),
        });
        if (!createRes.ok) {
            const errText = await createRes.text();
            console.error('Sheets API error creating workbook:', errText);
            return errorResponse('Failed to create user workbook.', 503, cors);
        }
        const createData = await createRes.json();
        newSpreadsheetId = createData.spreadsheetId;
    } catch {
        console.error('Network error creating workbook');
        return errorResponse('Failed to create user workbook.', 503, cors);
    }

    // --- Share the new workbook with the service account as editor ---
    // This makes the service account's access explicit and visible in the
    // sharing settings, even though the service account is already the owner.
    const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    if (serviceAccountEmail) {
        try {
            const shareRes = await fetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(newSpreadsheetId)}/permissions`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        role: 'writer',
                        type: 'user',
                        emailAddress: serviceAccountEmail,
                    }),
                },
            );
            if (!shareRes.ok) {
                // Non-fatal: log but continue – the SA already owns the file.
                console.warn('Drive API warning sharing workbook with service account');
            }
        } catch {
            console.warn('Network warning sharing workbook with service account');
        }
    }

    // --- Append new user row ---
    // Columns B–G: Username, Password, Credit, Number 1, Number 2, Workbook ID.
    // Column H (role) is intentionally left blank (non-admin by default).
    const sheetNameMatch = usersRange.match(/^(.+?)!/);
    const sheetName = sheetNameMatch ? sheetNameMatch[1] : 'Sheet1';
    const appendRange = `${sheetName}!B:G`;

    const newRow = [
        sanitizeValue(username.trim()),
        passwordHash,
        sanitizeValue(String(credit).trim()),
        sanitizeValue(String(number1).trim()),
        sanitizeValue(String(number2 || '').trim()),
        newSpreadsheetId,
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

    return jsonResponse({
        success: true,
        workbookId: newSpreadsheetId,
        workbookUrl: `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}`,
    }, 200, cors);
}
