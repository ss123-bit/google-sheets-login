// functions/api/sheets/create-sheet.js
// POST /api/sheets/create-sheet
// Body: { sheetId, title, settingsRow? }
//   sheetId     – spreadsheet ID to add the new tab to
//   title       – name for the new sheet/tab
//   settingsRow – optional array of values to append to the 'Settings' sheet
//                 e.g. [categoryName, categoryKey]
// Creates a new sheet tab (duplicate names are rejected with 409).
// Optionally appends a row to the 'Settings' tab.
// Requires X-App-Auth header containing a valid session token.

import { getGoogleAccessToken, jsonResponse, errorResponse, getCorsHeaders, CORS_HEADERS, checkAuth, validateSheetId, sanitizeValues, buildConcatFormula } from '../../_shared.js';

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
        const { sheetId, title, settingsRow } = body;

        if (!sheetId || !title) {
            return errorResponse('sheetId and title are required', 400, cors);
        }

        if (!validateSheetId(sheetId, env)) {
            return errorResponse('Forbidden: sheetId is not allowed', 403, cors);
        }

        const token = await getGoogleAccessToken(env);

        // Fetch current sheet list to check for duplicate names.
        const metaRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        if (!metaRes.ok) {
            console.error('Sheets API error fetching metadata in create-sheet:', metaRes.status);
            return errorResponse('Failed to read spreadsheet metadata', metaRes.status, cors);
        }

        const metaData = await metaRes.json();
        const sheets = metaData.sheets || [];

        if (sheets.some((s) => s.properties.title === title)) {
            return errorResponse(`A sheet named "${title}" already exists.`, 409, cors);
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
            console.error('Sheets API error creating sheet:', batchRes.status);
            return errorResponse('Failed to create sheet', batchRes.status, cors);
        }

        // Optionally append a row to the Settings sheet.
        // Columns A and B come from user input and are sanitised to prevent formula
        // injection even when using USER_ENTERED.  Column C holds a server-generated
        // TEXTJOIN formula that concatenates all values in column A of the new sheet
        // and must not be sanitised.
        if (Array.isArray(settingsRow) && settingsRow.length > 0) {
            // Ensure we always have at least two user-supplied columns (name, key).
            const paddedRow = settingsRow.slice(0, 2);
            while (paddedRow.length < 2) paddedRow.push('');
            const sanitisedCols = sanitizeValues([paddedRow])[0];
            const formula = buildConcatFormula(title);
            const rowToWrite = [...sanitisedCols, formula];
            const appendRes = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/Settings:append?valueInputOption=USER_ENTERED`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ values: [rowToWrite] }),
                },
            );

            if (!appendRes.ok) {
                // Sheet was created successfully but Settings update failed.
                // Return success with a warning so the caller is informed.
                return jsonResponse({
                    success: true,
                    warning: 'Sheet created but failed to update the Settings tab.',
                }, 200, cors);
            }
        }

        return jsonResponse({ success: true }, 200, cors);
    } catch (err) {
        console.error('Unexpected error in create-sheet:', err);
        return errorResponse('Internal server error', 500, cors);
    }
}
