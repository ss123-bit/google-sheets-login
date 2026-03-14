// functions/api/sheets/delete-sheet.js
// POST /api/sheets/delete-sheet
// Body: { sheetId, sheetName }
//   sheetId   – spreadsheet ID containing the tab to delete
//   sheetName – name of the sheet tab to delete (cannot be 'Settings')
// Deletes the sheet tab and removes the corresponding row from the Settings sheet.
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
        const { sheetId, sheetName } = body;

        if (!sheetId || !sheetName) {
            return errorResponse('sheetId and sheetName are required', 400, cors);
        }

        if (sheetName === 'Settings') {
            return errorResponse('Cannot delete the Settings sheet', 403, cors);
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
            console.error('Sheets API error fetching metadata in delete-sheet:', metaRes.status);
            return errorResponse('Failed to read spreadsheet metadata', metaRes.status, cors);
        }

        const meta = await metaRes.json();
        const sheets = meta.sheets || [];

        const targetSheet = sheets.find(s => s.properties.title === sheetName);
        if (!targetSheet) {
            return errorResponse('Sheet not found', 404, cors);
        }

        const tabId = targetSheet.properties.sheetId;
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`;

        // Delete the sheet tab.
        const batchRes = await fetch(batchUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [{ deleteSheet: { sheetId: tabId } }],
            }),
        });

        if (!batchRes.ok) {
            const errText = await batchRes.text();
            console.error('Sheets API error in delete-sheet batchUpdate:', batchRes.status, errText);
            return errorResponse('Failed to delete sheet', batchRes.status, cors);
        }

        // Remove the corresponding row from the Settings sheet.
        const settingsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/Settings!A:A`;
        const settingsRes = await fetch(settingsUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            const rows = settingsData.values || [];
            const rowIndex = rows.findIndex(row => row[0] === sheetName);

            if (rowIndex !== -1) {
                const settingsSheet = sheets.find(s => s.properties.title === 'Settings');
                if (settingsSheet) {
                    const settingsTabId = settingsSheet.properties.sheetId;
                    const cleanupRes = await fetch(batchUrl, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            requests: [{
                                deleteDimension: {
                                    range: {
                                        sheetId: settingsTabId,
                                        dimension: 'ROWS',
                                        startIndex: rowIndex,
                                        endIndex: rowIndex + 1,
                                    },
                                },
                            }],
                        }),
                    });
                    if (!cleanupRes.ok) {
                        console.warn('delete-sheet: sheet deleted but failed to remove Settings row for', sheetName);
                    }
                }
            }
        }

        return jsonResponse({ success: true }, 200, cors);
    } catch (err) {
        console.error('Unexpected error in delete-sheet:', err);
        return errorResponse('Internal server error', 500, cors);
    }
}
