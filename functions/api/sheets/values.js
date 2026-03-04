// functions/api/sheets/values.js
// GET /api/sheets/values?sheetId=<id>&range=<A1notation>
// Reads cell values from a Google Sheets spreadsheet using the service account.

import { getGoogleAccessToken, jsonResponse, errorResponse, CORS_HEADERS } from '../../_shared.js';

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
    try {
        const url = new URL(request.url);
        const sheetId = url.searchParams.get('sheetId');
        const range = url.searchParams.get('range');

        if (!sheetId || !range) {
            return errorResponse('sheetId and range query parameters are required');
        }

        const token = await getGoogleAccessToken(env);

        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`;

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
