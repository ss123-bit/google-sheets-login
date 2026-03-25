// functions/api/sms/incoming.js
// POST /api/sms/incoming
//
// Twilio webhook for incoming SMS messages.
//
// Twilio sends a POST request with application/x-www-form-urlencoded data:
//   From  – sender's phone number (E.164 format, e.g. +14155552671)
//   Body  – the SMS message text
//
// Required environment variables:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  – service account email
//   GOOGLE_PRIVATE_KEY            – PEM-encoded RSA private key
//   APP_SHEET_ID                  – comma-separated list of allowed sheet IDs
//                                   (must include the users sheet ID)
//
// Optional environment variables:
//   APP_USERS_SHEET_ID    – users spreadsheet ID; defaults to first ID in APP_SHEET_ID
//   APP_USERS_SHEET_RANGE – range containing user data (default: "Sheet1!B:G").
//                           Only the sheet name portion is used; columns are always B:G.
//   TWILIO_AUTH_TOKEN     – when set, every inbound request is validated against the
//                           X-Twilio-Signature header to reject spoofed/forged requests.
//   TWILIO_ACCOUNT_SID    – Twilio account SID; required for sending outbound SMS replies.
//   TWILIO_FROM_NUMBER    – E.164 Twilio phone number to use as the sender of outbound SMS.
//
// Users spreadsheet column layout (columns B–G):
//   B – Username
//   C – Password       (not read here)
//   D – TasksSheetUrl  (URL of the user's personal Google Sheet)
//   E – Credit         (number of SMS credits remaining; must be > 0)
//   F – Phone1         (primary phone number)
//   G – Phone2         (secondary/alternate phone number)
//
// Processing logic:
//   1. Look up the sender's phone number in columns F and G of the users sheet.
//   2. Reject if credit (column E) is not above zero.
//   3. Extract the user's spreadsheet ID from the column D URL.
//   4. Read the "Settings" sheet of that spreadsheet (columns A:C).
//   5. If the SMS body starts with "?":
//        – Extract the word immediately following "?" (case-insensitive; a space after "?" is allowed).
//        – Search column A of Settings for a matching category (case-insensitive).
//        – If a match is found, send an outbound SMS to the sender with the text
//          from column C of that Settings row (requires TWILIO_ACCOUNT_SID,
//          TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to be set).
//        – Decrement the user's credit and return (no message is stored in a sheet).
//   6. Otherwise, compare the first word of the SMS body (case-insensitive) against
//      every value in column B of the Settings sheet.
//   7. If a match is found:
//        – Target sheet = value in column A of the matching Settings row.
//        – Message to store = remainder of the SMS after the first word.
//   8. If no match:
//        – Target sheet = "GENERAL".
//        – Message to store = full SMS body.
//   9. Append the message to the next empty cell in column A of the target sheet.
//  10. Decrement the credit value in column E of the users sheet by 1.

import { getGoogleAccessToken, sanitizeValue } from '../../_shared.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a minimal TwiML response (no reply SMS is sent).
 */
function twimlResponse() {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
    });
}

/**
 * Extracts the Google Sheets spreadsheet ID from a Sheets URL.
 * Supports the standard /spreadsheets/d/<ID>/ pattern.
 *
 * @param {string} url - A Google Sheets URL.
 * @returns {string|null} The spreadsheet ID, or null if not found.
 */
function extractSheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

/**
 * Verifies the X-Twilio-Signature header using HMAC-SHA-1.
 *
 * Algorithm (https://www.twilio.com/docs/usage/webhooks/webhooks-security):
 *   1. Start with the full URL of the webhook.
 *   2. Sort all POST parameters alphabetically (by parameter name).
 *   3. Iterate through the sorted list and append the variable name and value
 *      (with no delimiters) to the URL string.
 *   4. Sign the resulting string with HMAC-SHA-1 using the auth token.
 *   5. Base64-encode the signature.
 *   6. Compare with the X-Twilio-Signature header value.
 *
 * @param {Request} request - The incoming request.
 * @param {string} authToken - The Twilio auth token.
 * @param {string} rawBody - The raw form-encoded POST body.
 * @returns {Promise<boolean>} True when the signature is valid.
 */
async function verifyTwilioSignature(request, authToken, rawBody) {
    const signature = request.headers.get('X-Twilio-Signature');
    if (!signature) return false;

    const url = request.url;
    const params = new URLSearchParams(rawBody);

    // Sort parameters alphabetically and concatenate key+value to the URL.
    const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    let toSign = url;
    for (const [key, value] of sorted) {
        toSign += key + value;
    }

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(authToken),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
    );

    const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(toSign));
    const sigBytes = new Uint8Array(sigBuffer);
    let sigBinary = '';
    for (const byte of sigBytes) sigBinary += String.fromCharCode(byte);
    const computed = btoa(sigBinary);

    return computed === signature;
}

/**
 * Sends an outbound SMS via the Twilio REST API.
 *
 * @param {object} env           - Cloudflare environment bindings.
 * @param {string} to            - Destination phone number (E.164).
 * @param {string} body          - SMS message text.
 * @returns {Promise<void>}
 */
async function sendSms(env, to, body) {
    const accountSid = (env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = (env.TWILIO_AUTH_TOKEN || '').trim();
    const fromNumber = (env.TWILIO_FROM_NUMBER || '').trim();

    if (!accountSid || !authToken || !fromNumber) {
        console.error('SMS webhook: cannot send outbound SMS – TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER is not configured');
        return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const credentials = btoa(`${accountSid}:${authToken}`);
    const params = new URLSearchParams({ From: fromNumber, To: to, Body: body });

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });
        if (!res.ok) {
            console.error('SMS webhook: Twilio API error sending outbound SMS:', res.status);
        }
    } catch {
        console.error('SMS webhook: network error sending outbound SMS');
    }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env }) {
    // Read the raw body first (needed for signature verification and parsing).
    let rawBody;
    try {
        rawBody = await request.text();
    } catch {
        console.error('SMS webhook: failed to read request body');
        return twimlResponse();
    }

    // --- Optional Twilio signature verification ---
    if (env.TWILIO_AUTH_TOKEN) {
        let valid = false;
        try {
            valid = await verifyTwilioSignature(request, env.TWILIO_AUTH_TOKEN, rawBody);
        } catch {
            console.error('SMS webhook: error verifying Twilio signature');
        }
        if (!valid) {
            console.error('SMS webhook: invalid Twilio signature – request rejected');
            return new Response('Forbidden', { status: 403 });
        }
    }

    // --- Parse Twilio parameters ---
    const params = new URLSearchParams(rawBody);
    const from = (params.get('From') || '').trim();
    const smsBody = (params.get('Body') || '').trim();

    if (!from) {
        console.error('SMS webhook: missing From parameter');
        return twimlResponse();
    }

    // --- Resolve users spreadsheet ---
    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('SMS webhook: APP_SHEET_ID is not configured');
        return twimlResponse();
    }
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();

    // Extract the sheet/tab name from APP_USERS_SHEET_RANGE (default: Sheet1).
    const usersRangeSetting = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:G').trim();
    const sheetNameMatch = usersRangeSetting.match(/^(.+?)!/);
    const sheetName = sheetNameMatch ? sheetNameMatch[1] : 'Sheet1';

    // Always read columns B through G for this handler.
    const readRange = `${sheetName}!B:G`;

    // --- Obtain Google access token ---
    let accessToken;
    try {
        accessToken = await getGoogleAccessToken(env);
    } catch {
        console.error('SMS webhook: failed to obtain Google access token');
        return twimlResponse();
    }

    // --- Read the users sheet ---
    let rows;
    try {
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(readRange)}`;
        const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
            console.error('SMS webhook: Sheets API error reading users sheet:', res.status);
            return twimlResponse();
        }
        const data = await res.json();
        rows = data.values || [];
    } catch {
        console.error('SMS webhook: network error reading users sheet');
        return twimlResponse();
    }

    // --- Find the user row by phone number (columns F and G, indices 4 and 5) ---
    // rows[0] is the header row; data rows start at index 1.
    let matchedRowIndex = -1;
    let matchedRow = null;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const phone1 = (row[4] || '').trim();
        const phone2 = (row[5] || '').trim();
        if ((phone1 && phone1 === from) || (phone2 && phone2 === from)) {
            matchedRowIndex = i;
            matchedRow = row;
            break;
        }
    }

    if (!matchedRow) {
        console.log('SMS webhook: no user found for phone number:', from);
        return twimlResponse();
    }

    // --- Check credit (column E, index 3 in the B:G range) ---
    const credit = parseFloat((matchedRow[3] || '').trim());
    if (isNaN(credit) || credit <= 0) {
        console.log('SMS webhook: insufficient credit for phone number:', from);
        return twimlResponse();
    }

    // --- Extract the user's spreadsheet ID from column D (index 2) ---
    const tasksSheetUrl = (matchedRow[2] || '').trim();
    const userSheetId = extractSheetId(tasksSheetUrl);
    if (!userSheetId) {
        console.error('SMS webhook: could not extract spreadsheet ID from URL:', tasksSheetUrl);
        return twimlResponse();
    }

    // --- Read the Settings sheet of the user's spreadsheet (columns A:C) ---
    let settingsRows;
    try {
        const settingsRange = 'Settings!A:C';
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(userSheetId)}/values/${encodeURIComponent(settingsRange)}`;
        const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
            console.error('SMS webhook: Sheets API error reading Settings sheet:', res.status);
            return twimlResponse();
        }
        const data = await res.json();
        settingsRows = data.values || [];
    } catch {
        console.error('SMS webhook: network error reading Settings sheet');
        return twimlResponse();
    }

    // --- Determine target sheet and message content ---
    // Split the SMS body into the first word and the remainder.
    const normalizedBody = smsBody.replace(/\s+/g, ' ').trim(); // collapse any whitespace runs
    const spaceIndex = normalizedBody.indexOf(' ');
    const firstWord = spaceIndex >= 0 ? normalizedBody.slice(0, spaceIndex) : normalizedBody;
    const remainder = spaceIndex >= 0 ? normalizedBody.slice(spaceIndex + 1).trim() : '';

    // --- Handle ?-query: SMS starting with "?" triggers an outbound SMS reply ---
    // Format: ?<category> – e.g. "?MENU", "?menu", or "? MENU" (space after "?" is allowed)
    if (normalizedBody.startsWith('?')) {
        const queryWord = normalizedBody.slice(1).trim().split(' ')[0].toLowerCase();
        if (!queryWord) {
            // Bare "?" with no category word – ignore silently.
            return twimlResponse();
        }

        for (const settingsRow of settingsRows) {
            const category = (settingsRow[0] || '').trim().toLowerCase();
            if (category && category === queryWord) {
                const replyText = (settingsRow[2] || '').trim(); // column C
                if (replyText) {
                    await sendSms(env, from, replyText);
                } else {
                    console.warn('SMS webhook: ?-query matched category but column C is empty in Settings row');
                }
                break;
            }
        }

        // Decrement credit and return – no message is stored in a sheet for ?-queries.
        const sheetRowNum = matchedRowIndex + 1;
        const creditCellRange = `${sheetName}!E${sheetRowNum}`;
        const newCredit = credit - 1;
        try {
            const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(creditCellRange)}?valueInputOption=RAW`;
            const res = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    range: creditCellRange,
                    majorDimension: 'ROWS',
                    values: [[String(newCredit)]],
                }),
            });
            if (!res.ok) {
                console.error('SMS webhook: Sheets API error updating credit after ?-query:', res.status);
            }
        } catch {
            console.error('SMS webhook: network error updating credit after ?-query');
        }

        return twimlResponse();
    }

    let targetSheetName = 'GENERAL';
    let messageToAppend = smsBody;

    for (const settingsRow of settingsRows) {
        const keyword = (settingsRow[1] || '').trim();
        if (keyword && keyword === firstWord) {
            const sheetFromSettings = (settingsRow[0] || '').trim();
            if (!sheetFromSettings) {
                console.warn('SMS webhook: matched keyword but column A is empty in Settings row – falling back to GENERAL');
            }
            targetSheetName = sheetFromSettings || 'GENERAL';
            messageToAppend = remainder;
            break;
        }
    }

    // --- Append the message to the target sheet, column A ---
    try {
        const appendRange = `${targetSheetName}!A:A`;
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(userSheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [[sanitizeValue(messageToAppend)]] }),
        });
        if (!res.ok) {
            console.error('SMS webhook: Sheets API error appending message:', res.status);
            return twimlResponse();
        }
    } catch {
        console.error('SMS webhook: network error appending message');
        return twimlResponse();
    }

    // --- Decrement credit in the users sheet (column E) ---
    // rows[0] is header at sheet row 1; rows[matchedRowIndex] is at sheet row (matchedRowIndex + 1).
    const sheetRowNum = matchedRowIndex + 1;
    const creditCellRange = `${sheetName}!E${sheetRowNum}`;
    const newCredit = credit - 1;

    try {
        const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(creditCellRange)}?valueInputOption=RAW`;
        const res = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                range: creditCellRange,
                majorDimension: 'ROWS',
                values: [[String(newCredit)]],
            }),
        });
        if (!res.ok) {
            // Credit update failure is logged but treated as non-fatal: the message has
            // already been successfully appended and Twilio requires an HTTP 200 response
            // to avoid retry storms.  Operators can monitor logs and correct credits manually.
            console.error('SMS webhook: Sheets API error updating credit:', res.status);
        }
    } catch {
        console.error('SMS webhook: network error updating credit');
    }

    return twimlResponse();
}
