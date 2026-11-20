# TCG Machines — Prod Improvement KPI Whiteboard

**Flat repository root, ready for GitHub → Railway.** This is the latest TV-fit/OS Lite build, with the full production goals, attendance, status tracking, A3 documents, staff acknowledgements, shipping, KPI reports, and display sizing. It is the **application**, not the one-page staff-feedback document.

## Files in the repo root

`server.js`, `index.html`, `logo.png`, `package.json`, `.gitignore`, `.env.example`, `README.md`, `START-WINDOWS.bat`, and `START-MAC.command`. There is **no nested application folder** and no `data` folder committed.

## Deploy on Railway from GitHub

1. Extract this ZIP, create a GitHub repository, then upload **the files themselves** to the top level of the repository (not the enclosing extracted folder). Upload the hidden `.gitignore` and `.env.example` too, if your uploader shows hidden files.
2. In Railway, create a Node.js service by choosing **Deploy from GitHub repo** and selecting this repository. Root directory should be `/` (the repository root).
3. **Before going live, attach a persistent Railway volume to this service** and choose the absolute mount path **`/data`**. Railway exposes `RAILWAY_VOLUME_MOUNT_PATH=/data` automatically; the app uses it without additional configuration. All mutable data and PDF uploads are saved there.
4. In Railway **Variables**, set:
   - `APP_PASSWORD` = your chosen team access password (the current local fallback is `566218`; for a public deployment, a longer secret is strongly recommended).
   - `TZ` = `America/Edmonton` (recommended).
   - `COOKIE_SECURE` = `true` (optional on Railway; the app automatically uses Secure cookies there).
   - **Do not set `PORT`: Railway supplies it automatically.**
   - **Leave `DATA_DIR` unset** so the volume mount path is selected automatically. If setting it explicitly, set `/data` (or a child directory on the same attached volume).
5. Railway should detect Node.js and run the `start` script from `package.json`. If needed, set the **Start Command** to `npm start`. Set the healthcheck path to **`/health`**. The health endpoint does not require a login.
6. Generate a Railway public domain under **Networking** and open the generated HTTPS link to sign in and test data entry.

Railway's current guidance says `railway.json` and `railway.toml` are deprecated for newly created services, so this package does not rely on either. Configure the volume, start command and healthcheck in the Railway dashboard.

**Data-loss safeguard:** On Railway the server refuses to start if there is no attached Railway volume, unless you explicitly opt into unsafe ephemeral storage with `ALLOW_EPHEMERAL_DATA=true` (not recommended). It also refuses to start if `DATA_DIR` points outside the attached volume. This helps prevent data from accidentally being stored in nonpersistent deployment files.

## Persistent storage: critical

All of the following are on the same attached volume:

```
/data/whiteboard.json
/data/a3-pdfs/<document-id>.pdf
```

Do not delete, detach, reinitialize or remount an existing production volume without taking a backup and migrating its contents. Changing your GitHub code does **not** erase the attached volume. If this is a **new service with a new volume**, it will start with the blank seeded dashboard until the old data is migrated. A JSON-only backup does **not** contain the uploaded PDFs; **back up the entire volume**, including the `a3-pdfs` directory. Railway supports volume backups and volume file management from its dashboard or CLI. If the app logs an `EACCES` permission error when writing to the volume, check the volume permissions and set `RAILWAY_RUN_UID=0` on the service as described in Railway's volume guidance.

Only run **one replica** of this app: its single JSON database is designed for one server process and volume, not concurrent writers on multiple replicas. Sessions are in memory: a restart requires users to sign in again, but saved production records remain on the volume.

If an existing copy stored state under `data/whiteboard.json` and `data/a3-pdfs`, copy those exact contents to the **root of the mounted volume**, so the app finds `/data/whiteboard.json` and `/data/a3-pdfs/`. Verify backups before migration.

## Features retained

- **TV / screen fit:** fullscreen TV View, automatic fit to screen, − / + 5% sizing adjustments, browser-saved sizing preference; responsive mobile layout.
- **Production targets:** daily, weekly and monthly new-machine and refurb-machine targets, counts and percent complete. Only **logged full-machine completions** count for progress, not module stage counts.
- **Editable daily goals:** Chassis, Conveyor, Scanner, Pre-testing, Testing, Shipping, Inventory, 3D Printing, Refurbs: Goal, Done, Coverage, Description, Pulse # (first three), and On Track / On Hold / Blocked status with Reason.
- **Team attendance:** staff roster, manual In / Out status and note fields; does not track payroll hours or verify identity.
- **Shipping:** confirm shipped units; today and month-to-date counters.
- **Issue tracking:** Production QC, Testing QC and Customer Service, Inventory improvements, 3D Printing print failures; recurring issue flags, KPI HTML/print reports, reporting period reset/compare.
- **Communication hub:** upload **multiple** A3 PDFs with required staff, per-document acknowledgements, new versions, archived originals, alerts for blocked/on-hold stations, expiring announcements, and quick links to TCG OS Lite, SOP Library and Guided Runs.
- **TCG OS Lite** default shortcut: https://tcgoslite.up.railway.app

## Testing locally

Install Node.js 20+; extract the ZIP and run `npm start` (or `START-WINDOWS.bat` / `START-MAC.command`). Open http://localhost:3000. With no `APP_PASSWORD` variable set, the original local test password is `566218`. Records are stored locally under `./data/`, ignored by Git; copy that folder when migrating local data.

## Security / compliance cautions

Use Railway HTTPS, keep your GitHub repo private if it contains internal operational details, and do not commit production data or passwords. The shared password allows anyone who knows it to edit goals, upload A3s, and select **another employee's name** to acknowledge an A3; this is **not an identity-verified compliance sign-off**. For higher assurance, use personal logins and unique per-person credentials. The session cookie is HTTP-only and Secure on Railway. New deployments reset login sessions.
