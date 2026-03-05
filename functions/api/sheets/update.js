// functions/api/sheets/update.js
// POST /api/sheets/update
// Body: { sheetId, range, values }
// Updates values in a Google Sheets range using the service account.
// Requires X-App-Auth header containing a valid session token.

import { getGoogleAccessToken, jsonResponse, errorResponse, getCorsHeaders, CORS_HEADERS, checkAuth, validateSheetId, sanitizeValues } from '../../_shared.js';

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
    const cors = getCorsHeaders(request, env);

    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    try {
        const body = await request.json();
        const { sheetId, range, values } = body;

        if (!sheetId || !range || !Array.isArray(values)) {
            return errorResponse('sheetId, range, and values (array) are required', 400, cors);
        }

        if (!validateSheetId(sheetId, env)) {
            return errorResponse('Forbidden: sheetId is not allowed', 403, cors);
        }

        const token = await getGoogleAccessToken(env);

        // Use RAW to prevent formula injection from user-controlled values.
        // Additionally sanitise values that start with formula-trigger characters.
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

        const res = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ range, majorDimension: 'ROWS', values: sanitizeValues(values) }),
        });

        if (!res.ok) {
            console.error('Sheets API error in update:', res.status);
            return errorResponse('Failed to update spreadsheet data', res.status, cors);
        }

        return jsonResponse(await res.json(), 200, cors);
    } catch (err) {
        console.error('Unexpected error in update:', err);
        return errorResponse('Internal server error', 500, cors);
    }
}
