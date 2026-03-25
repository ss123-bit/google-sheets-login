// functions/api/admin/add-credit.js
// POST /api/admin/add-credit
// Body: { username, amount }
//
// Adds the specified amount to the credit of the given user in the users
// spreadsheet.  Only users whose row in column H contains "admin" may call
// this endpoint.
//
// Assumptions about the users spreadsheet layout (matching login.js defaults):
//   Column B (index 0) – Username
//   Column C (index 1) – Password (not modified)
//   Column D (index 2) – TasksSheetUrl (not modified)
//   Column E (index 3) – Credit  ← updated by this endpoint
//   …
//   Column H (index 6) – Role ("admin" grants access)
// The first row is a header row (1-indexed row 1 in Sheets notation).

import {
    getGoogleAccessToken,
    getCorsHeaders,
    jsonResponse,
    errorResponse,
    checkAuth,
    getUsernameFromToken,
    sanitizeValue,
} from '../../_shared.js';

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
    const cors = getCorsHeaders(request, env);

    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    const requestingUser = getUsernameFromToken(request);
    if (!requestingUser) {
        return errorResponse('Unauthorized', 401, cors);
    }

    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('APP_SHEET_ID is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();
    const usersRange = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:H').trim();

    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid request body.', 400, cors);
    }

    const { username, amount } = body || {};
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return errorResponse('username is required.', 400, cors);
    }
    if (amount === undefined || amount === null || amount === '') {
        return errorResponse('amount is required.', 400, cors);
    }
    const amountNum = Number(amount);
    if (Number.isNaN(amountNum)) {
        return errorResponse('amount must be a valid number.', 400, cors);
    }

    let token;
    try {
        token = await getGoogleAccessToken(env);
    } catch {
        console.error('Failed to obtain Google access token');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // Read columns B through H to find both the requesting admin and the target user.
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

    // Find the target user row (1-indexed; header is row 1 in Sheets notation).
    // rows[0] is the header (row index 0 in JS → Sheets row 1).
    // rows[1] is the first data row (row index 1 in JS → Sheets row 2).
    const sheetNameMatch = usersRange.match(/^(.+?)!/);
    const sheetName = sheetNameMatch ? sheetNameMatch[1] : 'Sheet1';

    let targetRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if ((rows[i][0] || '').trim() === username.trim()) {
            targetRowIndex = i;
            break;
        }
    }
    if (targetRowIndex === -1) {
        return errorResponse('User not found.', 404, cors);
    }

    // The target user's Sheets row number (1-indexed).
    // rows array starts at the beginning of usersRange which starts at column B.
    // Row 1 in the sheet = header row = rows[0].
    // Data starts at rows[1] = Sheets row 2.
    const sheetsRowNumber = targetRowIndex + 1; // rows index 1 → Sheets row 2, etc.

    const currentCreditRaw = rows[targetRowIndex][3]; // column E = index 3 within B:H
    const currentCredit = currentCreditRaw !== undefined && currentCreditRaw !== ''
        ? Number(currentCreditRaw)
        : 0;
    if (Number.isNaN(currentCredit)) {
        return errorResponse('Current credit value is not a valid number.', 500, cors);
    }

    const newCredit = currentCredit + amountNum;

    // Update column E of the target row.
    // usersRange starts at column B, so column E is the 4th column = "E".
    const updateRange = `${sheetName}!E${sheetsRowNumber}`;

    try {
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(updateRange)}?valueInputOption=RAW`;
        const updateRes = await fetch(updateUrl, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [[sanitizeValue(String(newCredit))]] }),
        });
        if (!updateRes.ok) {
            console.error('Sheets API error updating credit');
            return errorResponse('Failed to update credit.', 503, cors);
        }
    } catch {
        console.error('Network error updating credit');
        return errorResponse('Failed to update credit.', 503, cors);
    }

    return jsonResponse({ success: true, newCredit }, 200, cors);
}
