# Installing Sawaari on your phone and your PC

All three clients (Android, Windows, PWA) talk to **one API and one database** running on your PC.

```
Phone / PC app  ──►  http://10.222.195.198:4000  ──►  Express API  ──►  PostgreSQL
```

---

## STEP 0 — Start the server on your PC (do this first)

Right-click **`start-sawaari.ps1`** → *Run with PowerShell*
(or paste into a terminal: `powershell -ExecutionPolicy Bypass -File .\start-sawaari.ps1`)

It starts PostgreSQL, the API and the web app, then opens your browser.
Keep that window open — closing it stops the platform.

Check it worked: <http://localhost:4000/api/health> should show `"ok": true`.

---

## 📱 PHONE (Android)

**1. Copy the APK to the phone**
`dist-android\LocalAutoBooking.apk` → USB cable, Google Drive, email or WhatsApp to yourself.

**2. Install it**
Tap the file on the phone → Android asks *"Install unknown apps"* → allow it for the app you
opened it from (Files / Chrome / Drive) → tap **Install**.

**3. Point the app at your PC**
Open **Sawaari** → on the sign-in screen tap **Server settings** (bottom of the screen) →

```
http://10.222.195.198:4000
```

→ **Test connection** → **Save & reload**.

> The phone must be on the **same Wi-Fi** as the PC. If the address changes, reopen
> Server settings and enter the new one. Your PC's address: `ipconfig` → IPv4 Address.

**4. Use it**
Register a rider or driver, or sign in. Your data, rides and payments are the same ones the
web app uses.

---

## 💻 PC (Windows)

### Option A — Install as an app (PWA) — recommended, no .exe needed

1. Chrome or Edge → <http://localhost:5173>
2. Click the **install icon** in the address bar (⊕ / ⬇), or **⋮ → Apps → Install this site as an app**
3. It lands on your desktop with the Sawaari icon and opens in its own window

Works offline for the app shell, keeps your session, and is not blocked by antivirus.

### Option B — Installer

1. Double-click `dist-windows\LocalAutoBooking-Setup.exe`
2. *Next → Next → Install* (no admin rights needed — it installs for your user)
3. Start-menu and desktop shortcuts are created

### Option C — Portable (nothing installed)

1. Double-click `dist-windows\LocalAutoBooking-Portable.exe`
2. It unpacks to a temp folder and runs immediately

The desktop app talks to `http://localhost:4000` automatically.

> **If Windows warns about the file:** click *More info → Run anyway*. On a PC with
> *Smart App Control* or a strict App Control policy, unsigned executables are blocked
> outright — use **Option A (PWA)**, which needs no local executable.

---

## 🔎 If something does not work

| Problem | Fix |
|---|---|
| App says *"Cannot reach the Sawaari server"* | The server is not running → run `start-sawaari.ps1`. On the phone, check the Server settings address matches `ipconfig`. |
| Phone shows "connection refused" | Phone is on a different Wi-Fi, or the PC firewall is blocking port 4000 — allow Node.js on the *Private* network. |
| Android says "app not installed" | The file was renamed to `.apk.txt` by the transfer — rename it back to `.apk`. Or transfer it as a file, not a document. |
| No OTP on the phone | SMS is in dev mode — the code is printed in the API console (`.logs\api.log`). |
| Windows blocks the installer | App Control blocks unsigned binaries → use the PWA (Option A). |
| Map is blank | The device needs internet access for map tiles. |
| "You are offline" | The API is down; restart it with `start-sawaari.ps1`. |

---

## 🔒 Keeping it safe

* `server\.env` holds the secrets — never share or commit it.
* The Android signing key is `web\android\sawaari-release.keystore`
  (copy in `server\backups\`) — **keep it**, or you cannot publish updates to the same app.
* `server\backups\` also holds a database dump — `npm run db:backup` before big changes.
* The Super Admin password lives in `server\.env` → `SUPER_ADMIN_PASSWORD`.
