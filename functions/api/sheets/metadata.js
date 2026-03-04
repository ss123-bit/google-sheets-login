// functions/api/sheets/metadata.js
// GET /api/sheets/metadata?sheetId=<id>
// Returns spreadsheet metadata (sheet/tab names) using the service account.

import { getGoogleAccessToken, jsonResponse, errorResponse, CORS_HEADERS } from '../../_shared.js';

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
    try {
        const url = new URL(request.url);
        const sheetId = url.searchParams.get('sheetId');

        if (!sheetId) {
            return errorResponse('sheetId query parameter is required');
        }

        const token = await getGoogleAccessToken(env);

        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`;

        const res = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            const text = await res.text();
            return errorResponse(`Sheets API error: ${text}`, res.status);
        }

        return jsonResponse(await res.json());
    } catch (err) {
        return errorResponse(err.message, 500);
    }
}
