// functions/_shared.js
// Shared utilities for Cloudflare Pages Functions

export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Auth',
};

/**
 * Returns a JSON response with CORS headers.
 */
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

/**
 * Returns a JSON error response with CORS headers.
 */
export function errorResponse(message, status = 400) {
    return jsonResponse({ error: message }, status);
}

/**
 * Validates the X-App-Auth header for write endpoints.
 * If APP_AUTH_SECRET env var is not set, all requests are allowed.
 * Returns true when the request is authorised.
 */
export function checkAuth(request, env) {
    const secret = env.APP_AUTH_SECRET;
    if (!secret) return true;
    return request.headers.get('X-App-Auth') === secret;
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
