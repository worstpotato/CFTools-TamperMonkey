# CFTools Tools: Helper Utility

Tampermonkey userscript for CFTools that adds a few admin quality-of-life tools:

- Copy DayZ admin coordinates in `X,Z,Y` format
- Create a Discord ban entry template from a player profile
- Compare trace names between two CFTools profiles

## What It Works On

- `https://app.cftools.cloud/*`
- Other `cftools.cloud` pages matched by the userscript header

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

### 3. Compare Traces

On the profile `Identities` / `Traces` area, the script adds a `Compare Traces` button.

It will:

1. Ask for another CFTools profile URL.
2. Collect traces from the current profile.
3. Open the other profile.
4. Collect its traces.
5. Copy the shared traces to your clipboard.
