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
//      using the Google Drive API (mimeType application/vnd.google-apps.spreadsheet),
//      then rename the default sheet to "GENERAL" and add a "Settings" sheet via
//      the Sheets API batchUpdate.
//      The workbook is NOT shared with anyone beyond the service account owner.
//   3. Append a new row to the users sheet with columns:
//        B: Username | C: PBKDF2 password hash | D: Workbook URL (full URL)
//        E: Credit   | F: Number 1              | G: Number 2 (optional)
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

    // --- Create a new Google Sheets workbook for the user via Google Drive API ---
    // The workbook is titled after the username and pre-provisioned with two
    // sheets: "GENERAL" (the default working sheet) and "Settings".
    let newSpreadsheetId;
    try {
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: username.trim(),
                mimeType: 'application/vnd.google-apps.spreadsheet',
            }),
        });
        if (!createRes.ok) {
            const errText = await createRes.text();

            let errJson = null;
            try { errJson = JSON.parse(errText); } catch {}

            console.error('Drive API error creating workbook: status', createRes.status);
            console.error('Drive API error creating workbook: body', errText);

            if (errJson?.error) {
                console.error('Drive API error creating workbook: message', errJson.error.message);
                console.error('Drive API error creating workbook: status', errJson.error.status);
                console.error('Drive API error creating workbook: code', errJson.error.code);
                console.error('Drive API error creating workbook: errors', JSON.stringify(errJson.error.errors || null));
                console.error('Drive API error creating workbook: details', JSON.stringify(errJson.error.details || null));
            }

            return errorResponse('Failed to create user workbook.', 503, cors);
        }
        const createData = await createRes.json();
        newSpreadsheetId = createData.id;
    } catch {
        console.error('Network error creating workbook');
        return errorResponse('Failed to create user workbook.', 503, cors);
    }

    // --- Provision sheets: rename default sheet to "GENERAL" and add "Settings" ---
    try {
        // Fetch the new workbook's sheet metadata to obtain the default sheet's sheetId.
        const metaRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(newSpreadsheetId)}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!metaRes.ok) {
            const metaErrText = await metaRes.text();
            console.error('Sheets API error fetching new workbook metadata: status', metaRes.status);
            console.error('Sheets API error fetching new workbook metadata: body', metaErrText);
            return errorResponse('Failed to provision user workbook.', 503, cors);
        }
        const metaData = await metaRes.json();
        if (!metaData.sheets?.[0]?.properties) {
            console.error('Sheets API returned unexpected metadata structure for new workbook');
            return errorResponse('Failed to provision user workbook.', 503, cors);
        }
        const defaultSheetId = metaData.sheets[0].properties.sheetId;

        const batchRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(newSpreadsheetId)}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    requests: [
                        {
                            updateSheetProperties: {
                                properties: { sheetId: defaultSheetId, title: 'GENERAL' },
                                fields: 'title',
                            },
                        },
                        {
                            addSheet: {
                                properties: { title: 'Settings' },
                            },
                        },
                    ],
                }),
            },
        );
        if (!batchRes.ok) {
            const batchErrText = await batchRes.text();
            console.error('Sheets API error provisioning workbook sheets: status', batchRes.status);
            console.error('Sheets API error provisioning workbook sheets: body', batchErrText);
            return errorResponse('Failed to provision user workbook.', 503, cors);
        }
    } catch {
        console.error('Network error provisioning workbook sheets');
        return errorResponse('Failed to provision user workbook.', 503, cors);
    }

    // --- Append new user row ---
    // Columns B–G: Username, PasswordHash, Workbook URL, Credit, Number 1, Number 2.
    // Column D (Workbook URL) is returned to the client as tasksSheetUrl after login.
    // Column H (role) is intentionally left blank (non-admin by default).
    const workbookUrl = `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}`;
    const sheetNameMatch = usersRange.match(/^(.+?)!/);
    const sheetName = sheetNameMatch ? sheetNameMatch[1] : 'Sheet1';
    const appendRange = `${sheetName}!B:G`;

    const newRow = [
        sanitizeValue(username.trim()),
        passwordHash,
        workbookUrl,
        sanitizeValue(String(credit).trim()),
        sanitizeValue(String(number1).trim()),
        sanitizeValue(String(number2 || '').trim()),
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
        workbookUrl,
    }, 200, cors);
}
