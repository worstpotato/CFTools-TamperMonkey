# CFTools Tools: Helper Utility

Tampermonkey userscript for CFTools that adds a few admin quality-of-life tools:

- Copy DayZ admin coordinates in `X,Z,Y` format
- Create a Discord ban entry template from a player profile
- Compare trace names between two CFTools profiles
- Jump from an activity row straight into the matching server logs
- Scan a server dashboard for players banned as cheaters

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

1. Open a dialog asking for another CFTools profile URL.
2. Collect traces from the current profile.
3. Open the other profile.
4. Collect its traces.
5. Copy the shared traces to your clipboard.

To compare against more than one profile, press `Shift+Enter` in the dialog (or click
`Add another`) to add a field, and paste the next URL into it. `Enter` starts the
comparison, `Escape` closes the dialog, and `x` next to a field removes it.

With several URLs, the source profile is collected once and then compared against each
target in turn. The report lists every profile you entered, including the ones that shared
nothing.

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

### 5. Scan Bans

On a server dashboard, the script adds a `Scan Bans` button to the right-hand edge of the
player list's `Search` box.

Clicking it asks for a scan mode, then will:

1. Collect every player in the list carrying a `public bans` badge.
2. Open each of those profiles in this tab and read their `Bans` tab.
3. Return to the dashboard and copy a report to your clipboard.

There are three modes:

- `Light scan` checks each of those players for a cheater ban.
- `Deep scan` does the same, and also opens every **confirmed** alternate account of those
  players (the green `Confirmed alternate` badge under `Potential alternate accounts` on
  the Overview tab; unconfirmed alts are ignored). An alt is flagged if its BattlEye card
  reads `Bad standing`, or if it has any ban on `Companions-Banlist` or
  `KarmaKrew_Cheaters`, whatever the reason. Flagged alts are listed under the player they
  belong to. An alt shared by several players is only opened once. Alts of alts are not
  followed.
- `Extreme scan` runs the deep scan's alt check on **every** player in the list, not just
  the ones carrying a public ban, since a player with a clean record can still have a
  banned alt. Players without a public ban only get the alt check; their `Bans` tab is
  not opened.

A deep scan is slower: every confirmed alt costs another profile load. An extreme scan is
slower again, as it opens every profile on the server. The last mode you picked is
remembered for next time.

The report leads with how many players came back with a cheater ban, then lists them with
the ban list, reason and issue date for each match. A profile the scan could not read is
skipped and logged to the console.

Reports open in a window of the script's own rather than a browser alert, so every profile
URL in them is a link you can open in a new tab. The text is selectable, there is a `Copy`
button if you miss the clipboard toast, and `Escape` or a click outside closes it.

A reason mentioning `association` never counts, even when it also says `cheater`: being
banned for associating with one is not the same as being banned as one.

There is a second entry point next to `Servers` in the left sidebar, a red magnifying
glass beside the add-server and nav-settings icons. That one opens a picker listing every
server you have access to. Pick a scan mode, tick the servers you want and press `Scan`,
and it will:

1. Open each selected server's dashboard in turn and collect its banned players (or all
   of its players, on an extreme scan).
2. Visit every one of those profiles once, even if the player was on several of the
   servers. On a deep or extreme scan, their confirmed alts are checked as well.
3. Return to the page you started from with a report grouped by server. Only servers
   that turned up a cheater ban (or, on a deep or extreme scan, a flagged alt) get a
   section.

Your last selection is remembered and pre-ticked the next time you open the picker. The
first time, nothing is ticked. `Select all` / `Select none` are there for long lists.

The scan drives this tab, so leave it alone while it runs. Progress is shown as a toast per
server and per player, and it keeps its place across the page loads. A `Stop ban scan`
button sits in the bottom-right corner for as long as a scan is running; it takes effect at
the end of the profile the scan is currently on. If you navigate away mid-scan it pauses,
resumes if you return to the page it was on, and gives up after 10 minutes on one step.

Only `public bans` are followed up. A `VAC ban(s)` badge is Steam-side and carries no
reason text to match against.

#### Skip cache

Players who have been scanned are skipped by any scan for the next 24 hours, from either
button, whether they were flagged or not. A flagged player is reported once and then left
out of later reports until their ban count changes or the 24 hours are up. A skipped player
is left out of the scan and the report, which says how many were skipped
(`Skipped (scanned in the last 24h): 37`).

- A player is cached only once everything about them has been read, including every one of
  their confirmed alts on a deep or extreme scan. A profile, alt list or alt that failed to
  load keeps them out of the cache, so they are checked again next time.
- Alts are never cached or skipped, so a player who is not skipped always has all their
  alts checked.
- A light scan's result does not let a deep or extreme scan skip anyone, since a light scan
  never checks alts. A deep or extreme result covers any mode.
- If a cached player picks up a new public ban, they are scanned (and reported) again.
  Their ban badge on the player list is part of what is cached, so a new ban no longer
  matches.
- A cached player whose alt gets banned afterwards stays skipped until their entry expires.
  The cache does not know who anyone's alts are.
- The cache is per browser. Another admin scanning from their own browser has their own
  cache and still sees everyone.

Nothing about a player is stored. Each entry is a shortened SHA-256 hash of the player's
CFTools id and ban badge, with the time it was cached and whether alts were checked. Anyone
reading the storage cannot tell who is in it, though someone who already has a player's id
could hash it and check.

Tick `Ignore cache` in either scan dialog to scan and report everyone. Players still get
cached as they finish. To empty the cache, choose `Clear scan cache` from the Tampermonkey menu.

To hide the button, click the Tampermonkey icon while on a CFTools page and choose
`Hide Scan Bans button`. The same entry brings it back.

## Settings

Settings are toggled from the Tampermonkey menu: open a CFTools page and click the
Tampermonkey icon in the browser toolbar.

| Menu entry | Default | What it does |
| --- | --- | --- |
| `Hide / Show Server Logs buttons` | Shown | Whether activity rows get a `Server Logs` button |
| `Hide / Show Create Discord Ban Entry button` | Shown | Whether profiles get a `Create Discord Ban Entry` button |
| `Hide / Show Scan Bans buttons` | Shown | Whether the player list and the sidebar's `Servers` heading get their `Scan Bans` buttons |
| `Clear scan cache` | - | Not a setting: empties the Scan Bans skip cache, see above |
| `Enable / Disable debug logging` | Off | Verbose `[CFTools Tools]` console output, see Troubleshooting |

All four settings apply to any other CFTools tabs you have open without reloading them. They are
stored in the script's own Tampermonkey storage as `codex-server-logs-buttons`,
`codex-ban-entry-button`, `codex-cheater-scan-button` and `codex-debug-mode`. The server
picker's last selection is kept alongside them as `codex-cheater-scan-servers`, and the last
scan mode as `codex-cheater-scan-mode`, and the skip cache as `codex-cheater-scan-cache`.
All of them
can also be edited from the
Tampermonkey dashboard: open the script and select the `Storage` tab (set `Config mode`
to `Advanced` if you do not see it).

## Troubleshooting

CFTools changes its markup from time to time, which is usually why a button stops
appearing. The script has a debug mode that logs what it did and did not find.

Turn on `Enable debug logging` from the Tampermonkey menu (see Settings above), then
open devtools and look for `[CFTools Tools]` lines in the console. They report what the
script found and did not find on the page.
