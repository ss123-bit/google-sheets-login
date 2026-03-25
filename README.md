# google-sheets-login

A static task-management dashboard deployed on **Cloudflare Pages**.  
Users log in and view tasks that are stored in Google Sheets.  
All Google Sheets access is handled **server-side** through Cloudflare Pages Functions using a Google Service Account, so the spreadsheet can remain **Restricted** (no public sharing required).

> **No Google login required for visitors.**  
> The service account credentials live entirely in Cloudflare environment variables/secrets.  
> The Pages Functions obtain a short-lived access token server-side (JWT bearer flow) and call the Sheets API on behalf of the app.  
> End users never see a Google sign-in screen — they only interact with the app's own username/password form.

---

## Architecture

```
Browser (static HTML/CSS/JS)
        │
        │  POST /api/auth/login   (credentials → session token)
        │  /api/sheets/*          (all requests require X-App-Auth session token)
        ▼
Cloudflare Pages Functions  (functions/)
        │
        │  Google Sheets API v4  (Bearer token, Service Account)
        ▼
Google Sheets  (Restricted – shared only with service account)
```

---

## Setup

### 1. Create a Google Service Account

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select (or create) a project.
2. Enable the **Google Sheets API** for the project (`APIs & Services → Library`).
3. Go to `APIs & Services → Credentials → Create Credentials → Service Account`.
4. Give it a name (e.g. `sheets-backend`) and click **Done**.
5. Open the new service account, go to the **Keys** tab, click **Add Key → Create new key**, choose **JSON**, and download the file.
6. Note the **client_email** and **private_key** fields – you will use them below.

### 2. Share the spreadsheet(s) with the service account

For **every** Google Sheets workbook the app needs to read or write:

1. Open the spreadsheet in Google Sheets.
2. Click **Share** (top right).
3. Add the service account email (e.g. `sheets-backend@my-project.iam.gserviceaccount.com`).
4. Set the permission to **Editor** (required for write operations).
5. Uncheck "Notify people" and click **Share**.

The spreadsheet can stay **Restricted** – only the service account has access.

### 3. Configure Cloudflare Pages environment variables

In the Cloudflare dashboard, open your Pages project → **Settings → Environment variables** and add the following variables (mark them as **Secret** / encrypted):

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | **Yes** | The `client_email` from the downloaded JSON key file |
| `GOOGLE_PRIVATE_KEY` | **Yes** | The `private_key` from the JSON file (include the `-----BEGIN/END PRIVATE KEY-----` lines) |
| `APP_AUTH_SECRET` | **Yes** | A long random secret string used to sign session tokens. **The app refuses all requests if this is not set.** Generate with: `openssl rand -hex 32` |
| `APP_SHEET_ID` | **Yes** | Comma-separated list of permitted Google Spreadsheet IDs. Only these IDs are accepted in API requests. At minimum include your users spreadsheet ID. |
| `APP_ALLOWED_ORIGINS` | Recommended | Comma-separated list of permitted CORS origins, e.g. `https://your-project.pages.dev`. Defaults to `*` when not set. |
| `APP_USERS_SHEET_RANGE` | Optional | The A1 range containing the users table (default: `Sheet1!B:G`). Columns: Username \| PasswordHash \| TasksSheetUrl \| Credit \| Phone1 \| Phone2 |
| `APP_USERS_SHEET_ID` | Optional | Spreadsheet ID containing the users table. Defaults to the first ID in `APP_SHEET_ID`. Set this if your users table is in a separate spreadsheet from the tasks sheets. |
| `TWILIO_AUTH_TOKEN` | Recommended | Twilio account auth token. When set, the SMS webhook validates every inbound request using the `X-Twilio-Signature` header to reject spoofed requests. |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account SID. Required when using the `?`-query feature to send outbound SMS replies. |
| `TWILIO_FROM_NUMBER` | Optional | E.164 Twilio phone number (e.g. `+14155550123`) used as the sender for outbound SMS replies. Required when using the `?`-query feature. |

> **Important:** `APP_AUTH_SECRET` and `APP_SHEET_ID` are **required**. The application will deny all API requests if either is missing.

> **Tip:** You can copy the private key exactly as it appears in the JSON file (with `\n` escape sequences) – the Functions code normalises it automatically.

### 4. Deploy

Push to your Cloudflare Pages–connected Git branch.  
Cloudflare automatically builds the Pages Functions from the `functions/` directory and deploys them alongside the static assets.

For local development with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npx wrangler pages dev . \
  --binding GOOGLE_SERVICE_ACCOUNT_EMAIL=<email> \
  --binding GOOGLE_PRIVATE_KEY=<key> \
  --binding APP_AUTH_SECRET=<secret> \
  --binding APP_SHEET_ID=<spreadsheet-id> \
  --binding APP_ALLOWED_ORIGINS=http://localhost:8788
```

---

## API Endpoints

All endpoints are same-origin (`/api/…`) and proxied through Cloudflare Pages Functions.

| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Validate credentials; returns a session token |
| GET | `/api/sheets/values?sheetId=&range=` | **Yes** (`X-App-Auth`) | Read cell values |
| GET | `/api/sheets/metadata?sheetId=` | **Yes** (`X-App-Auth`) | Get sheet/tab names |
| POST | `/api/sheets/append` | **Yes** (`X-App-Auth`) | Append rows to a range |
| POST | `/api/sheets/update` | **Yes** (`X-App-Auth`) | Update values in a range |
| POST | `/api/sheets/create-sheet` | **Yes** (`X-App-Auth`) | Create a new tab + optionally append a Settings row |
| POST | `/api/sms/incoming` | Twilio signature | Twilio webhook for incoming SMS messages |

"Auth required" means the `X-App-Auth` header must contain a valid session token obtained from `/api/auth/login`.

### Authentication flow

1. Browser POSTs `{ username, password }` to `/api/auth/login`.
2. Server validates credentials against the users spreadsheet.
3. On success, server returns `{ token, tasksSheetUrl }`.
4. Browser stores the token in `sessionStorage` (cleared on tab close).
5. All subsequent API requests include `X-App-Auth: <token>`.

---

### SMS webhook (`/api/sms/incoming`)

Configure your Twilio phone number's "A message comes in" webhook to:

```
POST https://your-project.pages.dev/api/sms/incoming
```

**Users spreadsheet layout (columns B–G)**

| Column | Content |
|--------|---------|
| B | Username |
| C | Password hash |
| D | User's personal Google Sheet URL |
| E | SMS credit (integer; must be > 0 to accept messages) |
| F | Primary phone number (E.164, e.g. `+14155552671`) |
| G | Secondary/alternate phone number |

**User's personal spreadsheet – `Settings` sheet layout (columns A–C)**

| Column | Content |
|--------|---------|
| A | Category name (sheet name to route matching messages to; also used as the `?`-query keyword) |
| B | Keyword (first word of a non-`?` SMS to match, case-insensitive) |
| C | Reply text sent back via SMS when a `?`-query matches this category |

**Processing logic**

1. Twilio calls the webhook with the sender's number (`From`) and message text (`Body`).
2. The sender's phone number is looked up in columns F and G of the users sheet.
3. If no match, or if the user's credit (column E) is ≤ 0, the request is silently ignored.
4. The user's personal spreadsheet (URL in column D) is opened and the `Settings` sheet is read (columns A–C).
5. **If the SMS starts with `?`** (e.g. `?MENU` or `?menu`):
   - The word immediately after `?` is matched (case-insensitively) against column A of `Settings`.
   - If a match is found, an outbound SMS is sent to the sender containing the text from column C of that row.
   - If no match is found, the request is silently ignored (no reply is sent).
   - A bare `?` with no following word is silently ignored and no credit is consumed.
   - Otherwise, the user's credit is decremented by 5 per 160-character segment of the outgoing reply (minimum 5) and processing ends (no data is written to any sheet).  For example, a reply of 330 characters costs 15 credits (`ceil(330/160) × 5 = 3 × 5`).
6. Otherwise, the first word of the SMS is compared (case-insensitively) against every value in column B of `Settings`.
   - **Match found:** the remainder of the SMS (everything after the first word) is appended to the next empty cell in column A of the sheet named in column A of the matching Settings row.
   - **No match:** the full SMS text is appended to the next empty cell in column A of a sheet named `GENERAL`.
7. The user's credit in column E is decremented by 1.

**Twilio signature verification**

Set `TWILIO_AUTH_TOKEN` to your Twilio account auth token.  When set, every inbound webhook request is validated against the `X-Twilio-Signature` header.  Requests with a missing or invalid signature are rejected with HTTP 403.  It is strongly recommended to set this variable in production.

**Outbound SMS replies (`?`-query feature)**

To enable outbound SMS replies, set all three of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in your Cloudflare environment variables.  The `TWILIO_FROM_NUMBER` must be an E.164-formatted Twilio number that belongs to your account (e.g. `+14155550123`).  When any of these variables is missing the reply is silently skipped and an error is logged.

---

## Password Migration

> **If you have existing users with plaintext passwords in Google Sheets, migrate them to hashed form before deploying.**

The login endpoint supports both legacy plaintext passwords (for a graceful migration period) and PBKDF2-hashed passwords.

### Generating a password hash

Use the included migration helper (requires Node.js 18+):

```bash
node scripts/hash-password.mjs 'my-secret-password'
# Output example:
# pbkdf2:600000:a1b2c3d4e5f6...:deadbeef1234...
```

> **Cloudflare Workers CPU note:** The iteration count is stored inside the hash string and read back at verification time. Hashes generated with the default 600 000 iterations are secure but may approach Cloudflare Workers' CPU time limits on the free tier (50 ms). If you observe timeout errors on login, reduce the iteration count by editing `scripts/hash-password.mjs` and regenerating your password hashes. 100 000 iterations is a safe minimum.

### Migration steps

1. For each user in the Google Sheets users tab, run the helper with their current password.
2. Replace the plaintext password in column C with the generated `pbkdf2:…` hash.
3. The next login attempt for that user will be verified against the hash.
4. Once all users are migrated, the server will no longer accept plaintext passwords for any user whose password column starts with `pbkdf2:`.

---

## Verifying authentication behaviour (curl examples)

### Confirm unauthenticated read requests are rejected

```bash
# Should return HTTP 401
curl -i "https://your-project.pages.dev/api/sheets/values?sheetId=<id>&range=Sheet1!A1"
```

### Login and obtain a session token

```bash
TOKEN=$(curl -s -X POST https://your-project.pages.dev/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"correct-password"}' \
  | jq -r .token)
echo "Token: $TOKEN"
```

### Access a protected endpoint with the token

```bash
# Should return HTTP 200
curl -i "https://your-project.pages.dev/api/sheets/metadata?sheetId=<id>" \
  -H "X-App-Auth: $TOKEN"
```

### Confirm invalid credentials are rejected

```bash
# Should return HTTP 401
curl -i -X POST https://your-project.pages.dev/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"wrong-password"}'
```

---

## Security notes

- **Fail-closed auth:** If `APP_AUTH_SECRET` is not set, **all** API requests return 401/500. There is no insecure default.
- **Session tokens:** Short-lived (8 hours), HMAC-SHA-256 signed with `APP_AUTH_SECRET`. Stored in `sessionStorage` (not `localStorage`), so they are cleared when the browser tab is closed.
- **Password hashing:** PBKDF2-SHA-256 with 600 000 iterations (OWASP 2023 recommendation) and a random 16-byte salt per user.
- **Formula injection:** Write endpoints use `valueInputOption=RAW` and additionally prefix any value starting with `= + - @` with an apostrophe.
- **SheetId allowlist:** Only spreadsheet IDs listed in `APP_SHEET_ID` are accepted. Arbitrary client-supplied IDs are rejected with HTTP 403.
- **CORS:** Set `APP_ALLOWED_ORIGINS` to restrict cross-origin access to known deployment origins.
- **Rate limiting:** The login endpoint limits each IP to 10 attempts per minute (per edge isolate; not globally distributed).
- **Error messages:** Internal errors are logged server-side; only generic messages are returned to the client.
