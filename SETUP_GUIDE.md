# 📊 Google Sheets Database — Setup Guide

This guide connects your SicKloT website to Google Sheets so that every
contact form message and new user registration is saved to a live Google
Spreadsheet you can access from anywhere.

---

## ✅ What You Need

- A Google account
- ~10 minutes

---

## Step 1 — Create a Google Cloud Project

1. Open → **https://console.cloud.google.com/**
2. Click **"Select a project"** (top left) → **"New Project"**
3. Name it `SicKloT` → click **"Create"**
4. Make sure the new project is selected in the top dropdown

---

## Step 2 — Enable the Google Sheets API

1. In the left sidebar go to **APIs & Services → Library**
2. Search for **"Google Sheets API"**
3. Click it → click **"Enable"**

---

## Step 3 — Create a Service Account (the "bot user")

1. Go to **APIs & Services → Credentials**
2. Click **"+ Create Credentials"** → **"Service account"**
3. Fill in:
   - **Service account name:** `siklot-server`
   - **Description:** SicKloT website backend
4. Click **"Create and Continue"**
5. For **Role** → select **"Editor"** → click **"Continue"** → **"Done"**

---

## Step 4 — Download the Credentials JSON Key

1. On the **Credentials** page you'll see your new service account listed
2. Click on the service account name → go to the **"Keys"** tab
3. Click **"Add Key"** → **"Create new key"** → select **JSON** → **"Create"**
4. A `.json` file will download automatically

> **Rename that file to `google-credentials.json`**
> and place it in your Siklot project folder:
> `C:\Users\jaigu\OneDrive\Desktop\Siklot\google-credentials.json`

---

## Step 5 — Create the Google Spreadsheet

1. Open → **https://sheets.google.com/** → click the **"+"** button to create a new sheet
2. **Rename the spreadsheet** to `SicKloT Database` (click the title at the top)
3. The spreadsheet has one sheet tab by default called "Sheet1"
   - **Rename "Sheet1" to `Messages`** (right-click the tab → Rename)
   - Click the **"+"** button beside the tab to add a second sheet
   - **Rename the second sheet to `Users`**

Your spreadsheet should now have two tabs: **Messages** and **Users**

> ⚠️ The tab names must be exactly `Messages` and `Users` (capital M and U)

---

## Step 6 — Share the Spreadsheet with the Service Account

1. Open the `google-credentials.json` file you downloaded
2. Find the field `"client_email"` — copy the email address inside it
   - It looks like: `siklot-server@siklot-xxxxx.iam.gserviceaccount.com`
3. In your Google Sheet, click the **"Share"** button (top right)
4. Paste the service account email → set role to **"Editor"** → click **"Send"**

---

## Step 7 — Get the Spreadsheet ID

Look at the URL of your Google Sheet:
```
https://docs.google.com/spreadsheets/d/  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms  /edit
                                          ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
                                          This long string is your SPREADSHEET_ID
```

Copy that ID.

---

## Step 8 — Add the Spreadsheet ID to server.js

Open `C:\Users\jaigu\OneDrive\Desktop\Siklot\server.js`

Find this line near the top:
```javascript
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID_HERE';
```

Replace `YOUR_SPREADSHEET_ID_HERE` with your actual ID:
```javascript
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
```

---

## Step 9 — Restart the Server

Stop the server (Ctrl+C in the terminal) and start it again:
```powershell
powershell -ExecutionPolicy Bypass -Command "node server.js"
```

You should now see in the terminal:
```
  📊  Spreadsheet: "SicKloT Database"
  📋  Headers initialised in "Messages" sheet
  📋  Headers initialised in "Users" sheet
  ✅  Google Sheets database CONNECTED!
  🔗  https://docs.google.com/spreadsheets/d/YOUR_ID
```

---

## ✅ That's It!

Every contact form submission and signup will now appear in your Google Sheet **in real time**.

- **Messages** sheet → all contact form submissions
- **Users** sheet → all registered user accounts

Your admin panel at `http://localhost:3000/admin.html` reads from the same Google Sheet.

---

## 🔥 Troubleshooting

| Error | Fix |
|-------|-----|
| `google-credentials.json not found` | Make sure the file is in the Siklot folder |
| `SPREADSHEET_ID not set` | Update the value in server.js (Step 8) |
| `Missing sheets: Messages` | Create the "Messages" and "Users" tabs in your Sheet (Step 5) |
| `The caller does not have permission` | Share the Sheet with the service account email (Step 6) |
| `File not found` | Make sure the credentials JSON was correctly named `google-credentials.json` |

---

## 📁 Files in Your Project After Setup

```
Siklot/
├── server.js                  ← Backend server
├── google-credentials.json    ← ⚠️ KEEP SECRET - never share this file!
├── messages.json              ← Local fallback (still works as backup)
├── users.json                 ← Local fallback
├── SETUP_GUIDE.md             ← This file
└── ...
```

> ⚠️ **IMPORTANT:** Never upload `google-credentials.json` to GitHub or share it publicly.
> Add it to `.gitignore` if you use version control.
