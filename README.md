# Maxno

Custom black-and-white UI for the Xeno executor engine.

**Import scripts · Attach · Execute · In-game attach notice**

> Maxno is a custom front-end. The attach/execute engine is Xeno (`Xeno.dll`).  
> Use at your own risk. Antivirus may flag injectors. Roblox bans are possible.

## Easy install (recommended)

1. Download **`Install-Maxno.bat`** from the [latest release](https://github.com/maxhackin/Maxno/releases/latest)
2. Double-click it
3. Wait for it to finish
4. Open **Maxno** from your Desktop

Or one-liner in PowerShell:

```powershell
irm https://raw.githubusercontent.com/maxhackin/Maxno/main/installer/Install-Maxno.ps1 | iex
```

## What you get

- Black / white sharp UI
- Custom icon
- **Import** button (open `.lua` / `.txt` into a tab)
- Attach / Execute / Kill Roblox
- Attach toast: `MAXNO ATTACHED :3`

Install location: `%LOCALAPPDATA%\Maxno\`

## Manual install

1. Download `Maxno-portable.zip` from Releases
2. Extract anywhere
3. Run `Maxno.exe`

## Build notes (devs)

UI sources live in `ui/`:

- `index.html` — renderer
- `main.js` / `preload.js` — Electron main + bridge
- `maxno_attached_notice.lua` — autoexec notice script

Pack into the app:

```powershell
# stage must match Electron app layout (package.json, main.js, preload.js, build/)
npx --yes @electron/asar pack .\asar-stage .\app.asar
Copy-Item .\app.asar "$env:LOCALAPPDATA\Maxno\resources\app.asar" -Force
```

## Credits

- **Maxno UI** — custom front-end
- **Xeno** — attach/execute engine by Rizve ([xeno.now](https://xeno.now))

## Disclaimer

This project is for educational / personal use. You are responsible for how you use it.
