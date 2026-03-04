// functions/api/sheets/append.js
// POST /api/sheets/append
// Body: { sheetId, range, values }
// Appends rows to a Google Sheets range using the service account.
// Requires X-App-Auth header matching APP_AUTH_SECRET env var (when set).

import { getGoogleAccessToken, jsonResponse, errorResponse, CORS_HEADERS, checkAuth } from '../../_shared.js';

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
    if (!checkAuth(request, env)) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        const body = await request.json();
        const { sheetId, range, values } = body;

        if (!sheetId || !range || !Array.isArray(values)) {
            return errorResponse('sheetId, range, and values (array) are required');
        }

        const token = await getGoogleAccessToken(env);

        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values }),
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
