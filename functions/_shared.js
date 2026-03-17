// functions/_shared.js
// Shared utilities for Cloudflare Pages Functions

// Default CORS headers – used by responses when env is unavailable (e.g. during
// preflight if the handler receives no context). All request handlers that have
// access to `env` should call getCorsHeaders(request, env) instead.
export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Auth',
};

/**
 * Returns CORS headers with a tightened Allow-Origin when APP_ALLOWED_ORIGINS
 * is configured.  APP_ALLOWED_ORIGINS should be a comma-separated list of
 * allowed origins, e.g. "https://example.pages.dev,https://example.com".
 *
 * If the request Origin is in the allowlist the header reflects that exact
 * origin; otherwise it is omitted so the browser blocks the request.
 * If APP_ALLOWED_ORIGINS is not set the wildcard fallback is used.
 */
export function getCorsHeaders(request, env) {
    const allowedRaw = env && env.APP_ALLOWED_ORIGINS;
    const origin = request && request.headers.get('Origin');

    if (allowedRaw && origin) {
        const allowed = allowedRaw.split(',').map((o) => o.trim());
        if (allowed.includes(origin)) {
            return {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-App-Auth',
                'Vary': 'Origin',
            };
        }
        // Origin not in allowlist – omit Access-Control-Allow-Origin so the
        // browser blocks the cross-origin request (returning 'null' would still
        // allow the null-origin case, e.g. sandboxed iframes).
        return {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-App-Auth',
            'Vary': 'Origin',
        };
    }

    return CORS_HEADERS;
}

/**
 * Returns a JSON response with CORS headers.
 */
export function jsonResponse(data, status = 200, corsHeaders = CORS_HEADERS) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/**
 * Returns a JSON error response with CORS headers.
 */
export function errorResponse(message, status = 400, corsHeaders = CORS_HEADERS) {
    return jsonResponse({ error: message }, status, corsHeaders);
}

// Session token lifetime: 8 hours.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Creates an HMAC-SHA-256–signed session token for the given username.
 * Token format: base64url(username):expiry_ms:base64url(hmac)
 */
export async function createSessionToken(username, env) {
    const secret = env.APP_AUTH_SECRET;
    if (!secret) throw new Error('APP_AUTH_SECRET is not configured');

    const expiry = Date.now() + SESSION_TTL_MS;
    // btoa produces base64url-safe characters only (alphanumeric + - _) so the
    // pipe delimiter in the HMAC payload cannot appear in encodedUser, making
    // the token format unambiguous even for unusual usernames.
    const encodedUser = btoa(username).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = `${encodedUser}|${expiry}`;

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );

    const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuffer);
    let sigBinary = '';
    for (const byte of sigBytes) sigBinary += String.fromCharCode(byte);
    const hmac = btoa(sigBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return `${encodedUser}:${expiry}:${hmac}`;
}

/**
 * Validates the X-App-Auth header for all endpoints.
 *
 * SECURITY: Fails CLOSED – if APP_AUTH_SECRET is not configured, all requests
 * are DENIED (returns false).  Configure APP_AUTH_SECRET before deployment.
 *
 * Expects the header to contain an HMAC-signed session token issued by the
 * /api/auth/login endpoint.
 *
 * Returns true when the request is authorised, false otherwise.
 */
export async function checkAuth(request, env) {
    const secret = env && env.APP_AUTH_SECRET;
    if (!secret) {
        // Fail closed: deny all requests when the secret is not configured.
        return false;
    }

    const token = request.headers.get('X-App-Auth');
    if (!token) return false;

    const parts = token.split(':');
    if (parts.length !== 3) return false;

    const [encodedUser, expiryStr, hmac] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (!Number.isFinite(expiry) || Date.now() > expiry) return false;

    const payload = `${encodedUser}|${expiry}`;

    try {
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify'],
        );

        // Re-pad the base64url string before decoding.
        const pad = (s) => s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
        const hmacBytes = Uint8Array.from(atob(pad(hmac)), (c) => c.charCodeAt(0));

        return await crypto.subtle.verify(
            'HMAC',
            keyMaterial,
            hmacBytes.buffer,
            new TextEncoder().encode(payload),
        );
    } catch {
        return false;
    }
}

/**
 * Validates that the supplied sheetId is on the server-side allowlist.
 *
 * APP_SHEET_ID should be a comma-separated list of permitted spreadsheet IDs.
 * If APP_SHEET_ID is not set every sheetId is rejected (fail closed).
 *
 * Returns true when the sheetId is allowed.
 */
export function validateSheetId(sheetId, env) {
    const allowed = env && env.APP_SHEET_ID;
    if (!allowed) return false;
    const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    return list.includes(sheetId);
}

/**
 * Sanitises a cell value to prevent formula injection when written to Sheets.
 * This is applied on top of RAW valueInputOption as a defence-in-depth measure
 * (e.g. to protect re-imports where USER_ENTERED might be used).
 *
 * Values that start with = + - @ are prefixed with an apostrophe so that
 * Google Sheets treats them as text rather than formulas in USER_ENTERED mode.
 * Values already starting with an apostrophe are left unchanged (they are
 * already safe text-prefix markers and do not match the formula trigger chars).
 */
export function sanitizeValue(value) {
    if (typeof value !== 'string') return value;
    if (/^[=+\-@]/.test(value)) return `'${value}`;
    return value;
}

/**
 * Extracts the username from a previously validated session token.
 * MUST only be called after checkAuth has returned true for the same request.
 * Token format: base64url(username):expiry_ms:base64url(hmac)
 */
export function getUsernameFromToken(request) {
    const token = request.headers.get('X-App-Auth');
    if (!token) return null;
    const parts = token.split(':');
    if (parts.length !== 3) return null;
    const [encodedUser] = parts;
    try {
        const pad = (s) =>
            s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
        return atob(pad(encodedUser));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Shared PBKDF2 password utilities (used by login and change-password)
// ---------------------------------------------------------------------------

export function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

export function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Hashes a password using PBKDF2-SHA-256 with the given salt.
 * Returns a hex string.
 */
export async function pbkdf2Hash(password, saltHex, iterations) {
    const salt = hexToBytes(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        keyMaterial,
        256,
    );
    return bytesToHex(new Uint8Array(bits));
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export async function safeEqual(a, b) {
    const enc = new TextEncoder();
    const ka = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const kb = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const dummy = enc.encode('compare');
    const [sa, sb] = await Promise.all([
        crypto.subtle.sign('HMAC', ka, dummy),
        crypto.subtle.sign('HMAC', kb, dummy),
    ]);
    return bytesToHex(new Uint8Array(sa)) === bytesToHex(new Uint8Array(sb));
}

/**
 * Verifies a password against a stored value.
 * Supports both PBKDF2 hashed passwords and legacy plaintext passwords.
 * Returns { ok: boolean, legacy: boolean }.
 */
export async function verifyPassword(inputPassword, storedPassword) {
    if (storedPassword.startsWith('pbkdf2:')) {
        const parts = storedPassword.split(':');
        if (parts.length !== 4) return { ok: false, legacy: false };
        const [, iterStr, saltHex, storedHash] = parts;
        const iterations = parseInt(iterStr, 10);
        if (!Number.isFinite(iterations) || iterations < 1) return { ok: false, legacy: false };
        const computedHash = await pbkdf2Hash(inputPassword, saltHex, iterations);
        const ok = await safeEqual(computedHash, storedHash);
        return { ok, legacy: false };
    }
    // Legacy plaintext comparison.
    const ok = await safeEqual(inputPassword, storedPassword);
    return { ok, legacy: true };
}

/** Number of PBKDF2 iterations used when generating new password hashes. */
const PBKDF2_ITERATIONS = 50_000;

/**
 * Generates a new PBKDF2-SHA-256 hash for the given password.
 * Returns a string in the format "pbkdf2:<iterations>:<hex-salt>:<hex-hash>".
 */
export async function generatePbkdf2Hash(password) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = bytesToHex(saltBytes);
    const hash = await pbkdf2Hash(password, saltHex, PBKDF2_ITERATIONS);
    return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hash}`;
}

/**
 * Recursively sanitises all string values inside a 2-D values array.
 */
export function sanitizeValues(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row) => (Array.isArray(row) ? row.map(sanitizeValue) : row));
}

/**
 * Obtains a short-lived Google OAuth2 access token using the configured
 * service account credentials (JWT bearer flow).
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  – service account email address
 *   GOOGLE_PRIVATE_KEY            – PEM-encoded RSA private key
 *                                   (newlines may be stored as literal \n)
 */
export async function getGoogleAccessToken(env) {
    const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let pem = env.GOOGLE_PRIVATE_KEY;

    if (!email || !pem) {
        throw new Error(
            'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variables',
        );
    }

    // Cloudflare env vars sometimes store newlines as the literal two-char
    // sequence \n – normalise before parsing the PEM.
    pem = pem.replace(/\\n/g, '\n');

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };

    const toBase64Url = (obj) =>
        btoa(JSON.stringify(obj))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

    const signingInput = `${toBase64Url(header)}.${toBase64Url(claims)}`;

    // Strip PEM header/footer and whitespace, then decode.
    const pemBody = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, '');

    const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryKey.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
    );

    const sigBuffer = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(signingInput),
    );

    // Convert ArrayBuffer to base64url without spread (avoids call-stack limits).
    const sigBytes = new Uint8Array(sigBuffer);
    let sigBinary = '';
    for (const byte of sigBytes) {
        sigBinary += String.fromCharCode(byte);
    }
    const signature = btoa(sigBinary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const jwt = `${signingInput}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });

    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Google token exchange failed: ${text}`);
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token;
}
