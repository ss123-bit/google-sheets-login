// functions/api/auth/credit.js
// GET /api/auth/credit
//
// Returns the available credit (number of texts) for the authenticated user.
// The credit value is read from column E of the users spreadsheet.
//
// Assumptions about the users spreadsheet layout (matching login.js defaults):
//   Column B (index 0) – Username
//   Column C (index 1) – Password
//   Column D (index 2) – TasksSheetUrl
//   Column E (index 3) – Credit (number of texts available)
// The first row is a header row.

import {
    getGoogleAccessToken,
    getCorsHeaders,
    jsonResponse,
    errorResponse,
    checkAuth,
    getUsernameFromToken,
} from '../../_shared.js';

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
    const cors = getCorsHeaders(request, env);

    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    const username = getUsernameFromToken(request);
    if (!username) {
        return errorResponse('Unauthorized', 401, cors);
    }

    // --- Resolve users spreadsheet ---
    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('APP_SHEET_ID is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();

    // Extract sheet name from APP_USERS_SHEET_RANGE so we read the correct tab.
    const usersRange = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:D').trim();
    const sheetNameMatch = usersRange.match(/^(.+?)!/);
    const sheetName = sheetNameMatch ? sheetNameMatch[1] : 'Sheet1';

    // Read columns B through E (username, password, tasks URL, credit).
    const creditRange = `${sheetName}!B:E`;

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
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(creditRange)}`;
        const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
            console.error('Sheets API error fetching users for credit');
            return errorResponse('Service unavailable.', 503, cors);
        }
        const data = await res.json();
        rows = data.values || [];
    } catch {
        console.error('Network error fetching users from Sheets');
        return errorResponse('Service unavailable.', 503, cors);
    }

    // --- Find the user row (includes header at index 0) ---
    const userRow = rows.slice(1).find((r) => (r[0] || '').trim() === username.trim());
    if (!userRow) {
        return errorResponse('User not found.', 404, cors);
    }

    // Column E is index 3 (B=0, C=1, D=2, E=3).
    const credit = userRow[3] !== undefined ? userRow[3] : '';

    return jsonResponse({ credit }, 200, cors);
}
