// functions/api/admin/list-users.js
// GET /api/admin/list-users
//
// Returns a list of all usernames and their credit values from the users
// spreadsheet.  Only users whose row in column H contains "admin" may call
// this endpoint.
//
// Assumptions about the users spreadsheet layout (matching login.js defaults):
//   Column B (index 0) – Username
//   Column C (index 1) – Password (not returned)
//   Column D (index 2) – TasksSheetUrl (not returned)
//   Column E (index 3) – Credit
//   …
//   Column H (index 6) – Role ("admin" grants access)
// The first row is a header row and is skipped.

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

    let token;
    try {
        token = await getGoogleAccessToken(env);
    } catch {
        console.error('Failed to obtain Google access token');
        return errorResponse('Service unavailable.', 503, cors);
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

    // Build list of { username, credit } for all non-header rows.
    const users = rows.slice(1)
        .filter((r) => (r[0] || '').trim().length > 0)
        .map((r) => ({
            username: (r[0] || '').trim(),
            credit: r[3] !== undefined ? r[3] : '',
        }));

    return jsonResponse({ users }, 200, cors);
}
