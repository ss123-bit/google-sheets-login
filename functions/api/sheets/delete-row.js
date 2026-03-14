// functions/api/sheets/delete-row.js
// POST /api/sheets/delete-row
// Body: { sheetId, sheetName, rowIndex }
// Deletes a single row from a Google Sheets tab using the service account.
// rowIndex is 0-based (matching the position in the values array returned by the API).
// Requires X-App-Auth header containing a valid session token.

import { getGoogleAccessToken, jsonResponse, errorResponse, getCorsHeaders, checkAuth, validateSheetId } from '../../_shared.js';

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
        const { sheetId, sheetName, rowIndex } = body;

        if (!sheetId || !sheetName || typeof rowIndex !== 'number' || !Number.isInteger(rowIndex) || rowIndex < 0) {
            return errorResponse('sheetId, sheetName, and a non-negative integer rowIndex are required', 400, cors);
        }

        if (!validateSheetId(sheetId, env)) {
            return errorResponse('Forbidden: sheetId is not allowed', 403, cors);
        }

        const token = await getGoogleAccessToken(env);

        // Fetch spreadsheet metadata to resolve the sheet name to its numeric tab ID.
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties`;
        const metaRes = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!metaRes.ok) {
            console.error('Sheets API error fetching metadata in delete-row:', metaRes.status);
            return errorResponse('Failed to read spreadsheet metadata', metaRes.status, cors);
        }

        const meta = await metaRes.json();
        const sheet = (meta.sheets || []).find(s => s.properties.title === sheetName);
        if (!sheet) {
            return errorResponse('Sheet not found', 404, cors);
        }

        const tabId = sheet.properties.sheetId;

        // Delete the row using the batchUpdate API (0-based, endIndex is exclusive).
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`;
        const batchRes = await fetch(batchUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: tabId,
                            dimension: 'ROWS',
                            startIndex: rowIndex,
                            endIndex: rowIndex + 1,
                        },
                    },
                }],
            }),
        });

        if (!batchRes.ok) {
            const errText = await batchRes.text();
            console.error('Sheets API error in delete-row batchUpdate:', batchRes.status, errText);
            return errorResponse('Failed to delete row', batchRes.status, cors);
        }

        return jsonResponse({ success: true }, 200, cors);
    } catch (err) {
        console.error('Unexpected error in delete-row:', err);
        return errorResponse('Internal server error', 500, cors);
    }
}
