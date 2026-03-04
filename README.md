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
        │  /api/sheets/*  (same-origin)
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

| Variable | Description |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The `client_email` from the downloaded JSON key file |
| `GOOGLE_PRIVATE_KEY` | The `private_key` from the JSON file (include the `-----BEGIN/END PRIVATE KEY-----` lines; Cloudflare stores newlines as `\n` automatically) |
| `APP_AUTH_SECRET` | *(Optional)* A random secret string that the browser must send as the `X-App-Auth` request header for all write operations. Prevents unauthenticated write access from random clients. |

> **Tip:** You can copy the private key exactly as it appears in the JSON file (with `\n` escape sequences) – the Functions code normalises it automatically.

### 4. Update `script.js` (optional – APP_AUTH)

If you set `APP_AUTH_SECRET` in Cloudflare, also set the matching value in `CONFIG.APP_AUTH` inside `script.js` so the browser sends it with write requests:

```js
const CONFIG = {
    SHEET_ID: 'your-sheet-id',
    APP_AUTH: 'your-secret-value',  // must match APP_AUTH_SECRET env var
};
```

> Note: `APP_AUTH` is visible in the page source. It is not a substitute for keeping the service account key secure – it is only a lightweight anti-abuse measure suitable for small, trusted audiences.

### 5. Deploy

Push to your Cloudflare Pages–connected Git branch.  
Cloudflare automatically builds the Pages Functions from the `functions/` directory and deploys them alongside the static assets.

For local development with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npx wrangler pages dev . \
  --binding GOOGLE_SERVICE_ACCOUNT_EMAIL=<email> \
  --binding GOOGLE_PRIVATE_KEY=<key> \
  --binding APP_AUTH_SECRET=<secret>
```

---

## API Endpoints

All endpoints are same-origin (`/api/sheets/…`) and proxied through Cloudflare Pages Functions.

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/api/sheets/values?sheetId=&range=` | No | Read cell values |
| GET | `/api/sheets/metadata?sheetId=` | No | Get sheet/tab names |
| POST | `/api/sheets/append` | Yes (`X-App-Auth`) | Append rows to a range |
| POST | `/api/sheets/update` | Yes (`X-App-Auth`) | Update values in a range |
| POST | `/api/sheets/create-sheet` | Yes (`X-App-Auth`) | Create a new tab + optionally append a Settings row |

"Auth required" means the `X-App-Auth` header must be present when `APP_AUTH_SECRET` is configured.
