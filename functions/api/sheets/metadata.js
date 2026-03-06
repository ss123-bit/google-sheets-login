// functions/api/sheets/metadata.js
// GET /api/sheets/metadata?sheetId=<id>
// Returns spreadsheet metadata (sheet/tab names) using the service account.
// Requires X-App-Auth header containing a valid session token.

import { getGoogleAccessToken, jsonResponse, errorResponse, getCorsHeaders, CORS_HEADERS, checkAuth, validateSheetId } from '../../_shared.js';

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
    const cors = getCorsHeaders(request, env);

    if (!await checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401, cors);
    }

    try {
        const url = new URL(request.url);
        const sheetId = url.searchParams.get('sheetId');

        if (!sheetId) {
            return errorResponse('sheetId query parameter is required', 400, cors);
        }

        if (!validateSheetId(sheetId, env)) {
            return errorResponse('Forbidden: sheetId is not allowed', 403, cors);
        }

        const token = await getGoogleAccessToken(env);

        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`;

        const res = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            console.error('Sheets API error in metadata:', res.status);
            return errorResponse('Failed to read spreadsheet metadata', res.status, cors);
        }

        return jsonResponse(await res.json(), 200, cors);
    } catch (err) {
        console.error('Unexpected error in metadata:', err);
        return errorResponse('Internal server error', 500, cors);
    }
}
