# Salesforce for Claude — Setup Guide

## What you need before you start (5 mins, one-time)

### 1. Create a Salesforce Connected App

This gives Claude permission to talk to your Salesforce org.

1. Log into Salesforce
2. Go to **Setup** (gear icon, top right)
3. Search for **App Manager** in the Quick Find box
4. Click **New Connected App** (top right)
5. Fill in:
   - **Connected App Name:** Claude Desktop
   - **API Name:** Claude_Desktop (auto-fills)
   - **Contact Email:** your email
6. Check **Enable OAuth Settings**
7. Set **Callback URL:** `http://localhost:1717/OauthRedirect`
8. Under **Selected OAuth Scopes**, add: **Full access (full)**
9. Click **Save** — wait 2–10 minutes for it to activate

### 2. Enable Username-Password Login

1. Still in Setup, search for **OAuth and OpenID Connect Settings**
2. Turn on **Allow OAuth Username-Password Flows**
3. Click **Save**

### 3. Get your Consumer Key and Secret

1. Go back to **App Manager**
2. Find **Claude Desktop**, click the dropdown arrow → **View**
3. Click **Manage Consumer Details** (may ask you to verify)
4. Copy **Consumer Key** and **Consumer Secret** — paste them somewhere safe

### 4. Get your Security Token (if needed)

If your office network isn't whitelisted in Salesforce:

1. Click your profile picture → **Settings**
2. Go to **My Personal Information → Reset My Security Token**
3. Click **Reset Security Token**
4. Check your email — the token arrives in minutes

---

## Install (60 seconds)

1. Download **salesforce-mcp.dxt**
2. Open **Claude Desktop**
3. Double-click the .dxt file — an installation form appears
4. Fill in:
   - **Salesforce environment:** Production or Sandbox
   - **Username:** your Salesforce login email
   - **Password:** your Salesforce password
   - **Security token:** from Step 4 above (or leave blank if whitelisted)
   - **Consumer Key:** from Step 3
   - **Consumer Secret:** from Step 3
5. Click **Install**

That's it. The Salesforce tools appear immediately in Claude.

---

## What you can now ask Claude

```
"Show me all my open opportunities closing this quarter"

"What are the top 10 accounts by annual revenue?"

"Update the Acme deal to Closed Won at $250,000"

"Find all leads from the tech industry who haven't been contacted"

"Show me the Q4 Pipeline by Region report"

"Create a new contact: Sarah Jones, sarah@acme.com, at Acme Corp"

"Who are all the contacts at GlobalBank?"

"Post a Chatter note on opportunity 006XXX saying 'Deal reviewed — moving to legal'"

"Show me this week's sales dashboard"
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "INVALID_LOGIN" | Check your username and password. Security token may be wrong or expired. |
| "username password flows not enabled" | Do Step 2 above — enable the OAuth flow in Salesforce Setup. |
| Red dot next to Salesforce in Claude | Restart Claude Desktop. If it persists, re-enter your credentials. |
| "connected app not found" | Wait 10 minutes after creating the Connected App, then try again. |

---

## Security

- Your password and tokens are stored in your **Mac Keychain** or **Windows Credential Manager** — the same place your browser stores passwords
- They are never stored in plain text or sent to any third party
- Claude connects directly to your Salesforce org — no data passes through any intermediary server
- You can uninstall the extension at any time from Claude Desktop settings
