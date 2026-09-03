# CFTools Tools: Helper Utility

Tampermonkey userscript for CFTools that adds a few admin quality-of-life tools:

- Copy DayZ admin coordinates in `X,Z,Y` format
- Create a Discord ban entry template from a player profile
- Compare trace names between two CFTools profiles
- Jump from an activity row straight into the matching server logs

## Install Tampermonkey

### Google Chrome

1. Open the Chrome Web Store.
2. Search for `Tampermonkey`.
3. Open the Tampermonkey extension page.
4. Click `Add to Chrome`.
5. Confirm the install.

### Mozilla Firefox

1. Open the Firefox Add-ons site.
2. Search for `Tampermonkey`.
3. Open the Tampermonkey add-on page.
4. Click `Add to Firefox`.
5. Confirm the install.

## Install This Script

### Option 1: Direct install from GitHub

1. Make sure Tampermonkey is installed and enabled.
2. Open this install link:

[Install the userscript](https://github.com/worstpotato/CFTools-TamperMonkey/raw/refs/heads/main/cftools-vpp.user.js)

3. Tampermonkey should open an install page automatically.
4. Click `Install`.

### Option 2: Manual install from the repo

1. Open the repository:

[worstpotato/CFTools-TamperMonkey](https://github.com/worstpotato/CFTools-TamperMonkey)

2. Open the latest `.user.js` file in the repo.
3. Click the `Raw` button.
4. Tampermonkey should detect it and open the install screen.
5. Click `Install`.

## Update the Script

If you installed the script through Tampermonkey, it should use the built-in update link from the script header:

[Update / download URL](https://github.com/worstpotato/CFTools-TamperMonkey/raw/refs/heads/main/cftools-vpp.user.js)

You can also:

1. Open Tampermonkey.
2. Find `CFTools Tools: VPP Coord Copier`.
3. Check for updates manually.

## Features

### 1. Copy VPP Coordinates

When CFTools shows coordinates like:

- `X: 1998.39, Y: 7165.76, Z: 237.39`
- `position: [ 1998.39, 7165.76, 237.39 ]`

The script adds a `Copy X,Z,Y` button and copies them as:

`1998.39,237.39,7165.76`

### 2. Create Discord Ban Entry

On supported player profile pages, the script adds a `Create Discord Ban Entry` button.

It can fill:

- In-game name
- CFTools profile URL
- Steam64
- Active server
- Prompted reason
- Prompted term

To hide the button, click the Tampermonkey icon while on a CFTools page and choose
`Hide Create Discord Ban Entry button`. The same entry brings it back.

### 3. Compare Traces

On the profile `Identities` / `Traces` area, the script adds a `Compare Traces` button.

It will:

1. Ask for another CFTools profile URL.
2. Collect traces from the current profile.
3. Open the other profile.
4. Collect its traces.
5. Copy the shared traces to your clipboard.

### 4. Server Logs Shortcut

On profile activity rows for kill, damage, broken-leg and gas events, the script adds a
`Server Logs` button.

Clicking it opens that server's log page in a new tab and fills the filters in for you:

- Start date: 30 minutes before the event
- End date: 10 minutes after the event
- Geo-Search: the event's map position

The tab needs popups allowed for `app.cftools.cloud`. Server ids are read from CFTools'
own server nav on the page, so nothing needs configuring: every server on your account
works, and one added, renamed or removed in CFTools is picked up on the next page load.

To hide the buttons, click the Tampermonkey icon while on a CFTools page and choose
`Hide Server Logs buttons`. The same entry brings them back. Existing buttons disappear
immediately, in every open CFTools tab.

## Settings

Settings are toggled from the Tampermonkey menu: open a CFTools page and click the
Tampermonkey icon in the browser toolbar.

| Menu entry | Default | What it does |
| --- | --- | --- |
| `Hide / Show Server Logs buttons` | Shown | Whether activity rows get a `Server Logs` button |
| `Hide / Show Create Discord Ban Entry button` | Shown | Whether profiles get a `Create Discord Ban Entry` button |
| `Enable / Disable debug logging` | Off | Verbose `[CFTools Tools]` console output, see Troubleshooting |

All three apply to any other CFTools tabs you have open without reloading them. They are
stored in the script's own Tampermonkey storage as `codex-server-logs-buttons`,
`codex-ban-entry-button` and `codex-debug-mode`, and can also be edited from the
Tampermonkey dashboard: open the script and select the `Storage` tab (set `Config mode`
to `Advanced` if you do not see it).

## Troubleshooting

CFTools changes its markup from time to time, which is usually why a button stops
appearing. The script has a debug mode that logs what it did and did not find.

Turn on `Enable debug logging` from the Tampermonkey menu (see Settings above), then
open devtools and look for `[CFTools Tools]` lines in the console. They report what the
script found and did not find on the page.
