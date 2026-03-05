#!/usr/bin/env node
// scripts/hash-password.mjs
// Migration helper: generates a PBKDF2-SHA-256 password hash suitable for
// storing in the Google Sheets users table (replacing a plaintext password).
//
// Usage:
//   node scripts/hash-password.mjs <password>
//
// Output:
//   A string in the format  pbkdf2:<iterations>:<hex-salt>:<hex-hash>
//   Paste this value into the password column of your Google Sheet.
//
// Requirements: Node.js 18+ (Web Crypto API available globally).

import { webcrypto } from 'node:crypto';

const ITERATIONS = 600_000;
const SALT_BYTES = 16;

const password = process.argv[2];
if (!password) {
    console.error('Usage: node scripts/hash-password.mjs <password>');
    process.exit(1);
}

const crypto = webcrypto;

const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
);

const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    keyMaterial,
    256,
);

const toHex = (buf) =>
    Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

const saltHex = toHex(salt.buffer);
const hashHex = toHex(bits);

const result = `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
console.log(result);
