# Jarvis + site tracking: setup guide

Everything here is click-by-click. Nothing needs code. Do the parts in order.
Secrets (keys and passwords) only ever go into Vercel's **Environment Variables** screen, never into the code or a chat.

---

## Part 1: Add the database (Neon, through Vercel)

1. Go to **vercel.com**, log in, and open the **rsm-site** project.
2. Click the **Storage** tab at the top.
3. Click **Create Database** (it may say **Connect Database** or **Browse Marketplace**).
4. Pick **Neon** (Serverless Postgres) and click **Continue**.
5. Choose:
   - Region: **Washington, D.C., USA (East)**: closest to South Florida
   - Plan: **Free**
   - Name: `rsm-db`
6. Click **Create** (accept the terms if asked).
7. On the "Connect to project" screen:
   - Project: **rsm-site**
   - Environments: tick **Development**, **Preview** and **Production**
   - Leave "Custom prefix" **empty** (so the variable is called exactly `DATABASE_URL`)
   - Click **Connect**.

Vercel now adds `DATABASE_URL` (and a few other `PG...` / `POSTGRES_...` variables) to the project by itself. You don't need to copy anything yet.

## Part 2: Create the tables and Jarvis's read-only login

1. Still on the database page in Vercel, click **Open in Neon**. The Neon dashboard opens.
2. In Neon's left menu, click **SQL Editor**.
3. Open the file **`data/setup.sql`** from this project (on GitHub: the `jarvis` branch, folder `data`), copy everything in it, and paste it into the SQL Editor.
4. In the pasted text, find `CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD` and replace it with a new password:
   - **letters and numbers only** (no symbols, so it works inside a web address)
   - at least 24 characters, e.g. from a password manager's generator
   - write it down, you need it once more in Part 3
5. Click **Run**. You should see success messages (no red errors).

This creates the `page_views` and `inquiries` tables and a login called `jarvis_readonly` that can only **read** them.

## Part 3: Build the read-only database address

1. In Vercel: **rsm-site → Settings → Environment Variables**.
2. Find **DATABASE_URL**, click the eye icon to reveal it, and copy it. It looks like:
   `postgresql://neondb_owner:AbC123xyz@ep-something-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`
3. Paste it somewhere (Notes app) and change **only the part between `//` and `@`**:
   - before: `neondb_owner:AbC123xyz`
   - after: `jarvis_readonly:YOUR-PASSWORD-FROM-PART-2`
   Everything else stays the same.
4. That edited line is your **DATABASE_URL_READONLY**. You'll add it in Part 4.

## Part 4: Add the secret keys in Vercel

In Vercel: **rsm-site → Settings → Environment Variables**. For **each** row below:

1. Type the **Key** exactly as shown.
2. Paste the **Value**.
3. Environments: tick **Production** and **Preview**.
4. Turn on **Sensitive** if offered.
5. Click **Save**.

| Key | Value / where to get it |
|---|---|
| `DATABASE_URL_READONLY` | The line you built in Part 3. |
| `ANTHROPIC_API_KEY` | **console.anthropic.com** → log in → **API Keys** → **Create Key** → name it "RSM Jarvis" → copy (it starts with `sk-ant-`). You only see it once. |
| `ELEVENLABS_API_KEY` | **elevenlabs.io** → log in → click your profile (bottom left) → **API Keys** → **Create API key** → name "RSM Jarvis" → allow **Text to Speech** → copy. |
| `JUSTIN_PASSWORD` | A password Justin will type to log into Jarvis. Long is good (a short sentence works). |
| `TYLER_PASSWORD` | Tyler's password. Different from Justin's. |

`DATABASE_URL` is already there from Part 1. Don't change it.

## Part 5: Redeploy so the new settings take effect

Vercel only applies new variables to new deployments.

1. **rsm-site → Deployments**.
2. Find the newest deployment of the **jarvis** branch (Preview).
3. Click the **⋯** menu → **Redeploy** → **Redeploy**.
4. When it's done, click **Visit**, then add `/jarvis` to the end of the address.

## Using Jarvis

- Open `/jarvis`, pick your name, type your password. You stay logged in for 30 days on that device.
- Tap the mic (or press the **spacebar** on a computer) and talk. Tap again or just stop talking to send.
- Say **"let me talk to Scout"**, **"get me the Strategist"** or **"back to Jarvis"** to switch agents, or tap the names at the top.
- Voice input works in Chrome, Edge and Safari (including iPhone). In Firefox, use **Type instead**.

## Changing things later

- **Change a password:** edit `JUSTIN_PASSWORD` or `TYLER_PASSWORD` in Vercel and redeploy. Everyone gets logged out.
- **Update the business data:** replace `data/rsm-data.json` and deploy.
- **Voices / personalities:** `jarvis/agents.js`.
