// functions/api/sheets/rename-sheet.js
// POST /api/sheets/rename-sheet
// Body: { sheetId, oldName, newName }
//   sheetId – spreadsheet ID containing the sheet to rename
//   oldName – current name of the sheet tab
//   newName – new name for the sheet tab
// Renames the sheet tab. The Settings sheet cannot be renamed.
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
        const { sheetId, oldName, newName } = body;

        if (!sheetId || !oldName || !newName) {
            return errorResponse('sheetId, oldName, and newName are required', 400, cors);
        }

        if (oldName === 'Settings' || newName === 'Settings') {
            return errorResponse('Cannot rename the Settings sheet', 403, cors);
        }

        if (!validateSheetId(sheetId, env)) {
            return errorResponse('Forbidden: sheetId is not allowed', 403, cors);
        }

        const token = await getGoogleAccessToken(env);

        // Fetch spreadsheet metadata to resolve sheet names to numeric tab IDs.
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties`;
        const metaRes = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!metaRes.ok) {
            console.error('Sheets API error fetching metadata in rename-sheet:', metaRes.status);
            return errorResponse('Failed to read spreadsheet metadata', metaRes.status, cors);
        }

        const meta = await metaRes.json();
        const sheets = meta.sheets || [];

        const targetSheet = sheets.find(s => s.properties.title === oldName);
        if (!targetSheet) {
            return errorResponse(`Sheet "${oldName}" not found`, 404, cors);
        }

        if (sheets.some(s => s.properties.title === newName)) {
            return errorResponse(`A sheet named "${newName}" already exists.`, 409, cors);
        }

        const tabId = targetSheet.properties.sheetId;
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`;

        // Rename the sheet tab.
        const batchRes = await fetch(batchUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [{
                    updateSheetProperties: {
                        properties: { sheetId: tabId, title: newName },
                        fields: 'title',
                    },
                }],
            }),
        });

        if (!batchRes.ok) {
            const errText = await batchRes.text();
            console.error('Sheets API error in rename-sheet batchUpdate:', batchRes.status, errText);
            return errorResponse('Failed to rename sheet', batchRes.status, cors);
        }

        return jsonResponse({ success: true }, 200, cors);
    } catch (err) {
        console.error('Unexpected error in rename-sheet:', err);
        return errorResponse('Internal server error', 500, cors);
    }
}
