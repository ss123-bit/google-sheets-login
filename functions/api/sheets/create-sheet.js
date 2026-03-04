// functions/api/sheets/create-sheet.js
// POST /api/sheets/create-sheet
// Body: { sheetId, title, settingsRow? }
//   sheetId     – spreadsheet ID to add the new tab to
//   title       – name for the new sheet/tab
//   settingsRow – optional array of values to append to the 'Settings' sheet
//                 e.g. [categoryName, categoryKey]
// Creates a new sheet tab (duplicate names are rejected with 409).
// Optionally appends a row to the 'Settings' tab.
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
        const { sheetId, title, settingsRow } = body;

        if (!sheetId || !title) {
            return errorResponse('sheetId and title are required');
        }

        const token = await getGoogleAccessToken(env);

        // Fetch current sheet list to check for duplicate names.
        const metaRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        if (!metaRes.ok) {
            const text = await metaRes.text();
            return errorResponse(`Failed to get spreadsheet metadata: ${text}`, metaRes.status);
        }

        const metaData = await metaRes.json();
        const sheets = metaData.sheets || [];

        if (sheets.some((s) => s.properties.title === title)) {
            return errorResponse(`A sheet named "${title}" already exists.`, 409);
        }

        // Create the new sheet tab.
        const batchRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    requests: [
                        {
                            addSheet: {
                                properties: { title, index: sheets.length },
                            },
                        },
                    ],
                }),
            },
        );

        if (!batchRes.ok) {
            const text = await batchRes.text();
            return errorResponse(`Failed to create sheet: ${text}`, batchRes.status);
        }

        // Optionally append a row to the Settings sheet.
        if (Array.isArray(settingsRow) && settingsRow.length > 0) {
            const appendRes = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/Settings:append?valueInputOption=USER_ENTERED`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ values: [settingsRow] }),
                },
            );

            if (!appendRes.ok) {
                // Sheet was created successfully but Settings update failed.
                // Return success with a warning so the caller is informed.
                return jsonResponse({
                    success: true,
                    warning: 'Sheet created but failed to update the Settings tab.',
                });
            }
        }

        return jsonResponse({ success: true });
    } catch (err) {
        return errorResponse(err.message, 500);
    }
}
