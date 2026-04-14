// functions/api/auth/login.js
// POST /api/auth/login
// Body: { username, password }
//
// Validates user credentials against the users spreadsheet (APP_SHEET_ID /
// APP_USERS_SHEET_RANGE) and returns a short-lived HMAC-signed session token.
//
// Required environment variables:
//   APP_AUTH_SECRET     – shared HMAC secret used to sign session tokens
//   APP_SHEET_ID        – spreadsheet ID that contains the users tab
//                         (comma-separated if multiple IDs are allowed)
//   APP_USERS_SHEET_RANGE – optional range of users data, defaults to Sheet1!B:H
//                           Columns: Username | PasswordHash | WorkbookURL | Credit | Number1 | Number2 | Role
//                           Column H (index 6): set to "admin" to grant admin privileges
//
// Password column format:
//   Plaintext (legacy):  any string without a "pbkdf2:" prefix  →  accepted but
//                        triggers a server-side warning; migrate to hashed form.
//   PBKDF2 hash:         "pbkdf2:<iterations>:<hex-salt>:<hex-hash>"
//                        e.g. "pbkdf2:100000:a1b2c3...:d4e5f6..."

import {
    getGoogleAccessToken,
    getCorsHeaders,
    jsonResponse,
    errorResponse,
    createSessionToken,
    pbkdf2Hash,
    hexToBytes,
    bytesToHex,
    safeEqual,
    verifyPassword,
} from '../../_shared.js';

// ---------------------------------------------------------------------------
// In-memory rate limiter (per edge isolate).
// Limits to MAX_ATTEMPTS login attempts per window per IP.
// NOTE: This limiter is per-isolate and not distributed across edge locations.
// An attacker could bypass it by routing requests through different PoPs.
// For stronger guarantees, replace with a Durable Object or KV-backed limiter.
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 1000; // 1 minute
const attempts = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip) {
    const now = Date.now();
    const entry = attempts.get(ip);

    if (!entry || now > entry.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }

    if (entry.count >= MAX_ATTEMPTS) {
        return false;
    }

    entry.count += 1;
    return true;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function onRequestOptions({ request, env }) {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
    const cors = getCorsHeaders(request, env);

    // --- Rate limiting ---
    const ip =
        request.headers.get('CF-Connecting-IP') ||
        request.headers.get('X-Forwarded-For') ||
        'unknown';

    if (!checkRateLimit(ip)) {
        return errorResponse('Too many login attempts. Please try again later.', 429, cors);
    }

    // --- Validate env ---
    if (!env.APP_AUTH_SECRET) {
        console.error('APP_AUTH_SECRET is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }

    const sheetIdRaw = env.APP_SHEET_ID;
    if (!sheetIdRaw) {
        console.error('APP_SHEET_ID is not configured');
        return errorResponse('Server configuration error.', 500, cors);
    }
    // Use the first allowed sheet ID as the users spreadsheet.
    // If your users live in a different spreadsheet than the tasks sheets,
    // set APP_USERS_SHEET_ID to point specifically to the users spreadsheet.
    // Otherwise, the first ID in APP_SHEET_ID is used.
    const usersSheetId = (env.APP_USERS_SHEET_ID || sheetIdRaw.split(',')[0]).trim();

    const usersRange = (env.APP_USERS_SHEET_RANGE || 'Sheet1!B:H').trim();

    // --- Parse body ---
    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid request body.', 400, cors);
    }

    const { username, password } = body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return errorResponse('username and password are required.', 400, cors);
    }

    // --- Load users from Google Sheets ---
    let token;
    try {
        token = await getGoogleAccessToken(env);
    } catch {
        console.error('Failed to obtain Google access token');
        return errorResponse('Authentication service unavailable.', 503, cors);
    }

let rows;
try {
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(usersSheetId)}/values/${encodeURIComponent(usersRange)}`;
    const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        console.error('Sheets API error fetching users');
        return errorResponse('Service unavailable.', 503, cors);
    }
    const data = await res.json();
    rows = data.values || [];
} catch {
    console.error('Network error fetching users');
    return errorResponse('Service unavailable.', 503, cors);
}

    // --- Find user (skip header row) ---
    const userRow = rows.slice(1).find((r) => (r[0] || '').trim() === username.trim());

    if (!userRow) {
        // Constant-time delay to reduce user enumeration via timing differences.
        await new Promise((r) => setTimeout(r, 500));
        return errorResponse('Invalid username or password.', 401, cors);
    }

    const storedPassword = userRow[1] || '';
    const tasksSheetUrl = userRow[2] || '';
    const credit = parseFloat(userRow[3]) || 0;
    // Column H (index 6 from range start B) holds the user role.
    const role = (userRow[6] || '').trim().toLowerCase();
    const isAdmin = role === 'admin';

    // --- Verify password ---
    const { ok, legacy } = await verifyPassword(password, storedPassword);
    if (!ok) {
        return errorResponse('Invalid username or password.', 401, cors);
    }

    if (legacy) {
        console.warn(`User "${username}" is using a plaintext password. Migrate to PBKDF2 hash.`);
    }

    // --- Issue session token ---
    let sessionToken;
    try {
        sessionToken = await createSessionToken(username, env);
    } catch {
        console.error('Failed to create session token');
        return errorResponse('Authentication service unavailable.', 503, cors);
    }

    return jsonResponse({ token: sessionToken, tasksSheetUrl, isAdmin, credit }, 200, cors);
}
