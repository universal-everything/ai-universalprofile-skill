# Installing the Universal Profile skill inside a Meta Muse VM

Status: **candidate**. Muse agents run in a Linux VM with a terminal, a file system and network egress approved by Sentinel. Installing third-party Agent Skills there is not documented by Meta; this recipe uses only a shell, `curl`, `tar`, `sha256sum` and Node.js, and has not yet been proven end to end. If a step fails, report the exact step and error to the human instead of improvising.

Ask the human before installing anything. Never use `sudo`. Every command runs as the agent's own user.

## 1. Network approvals

Request Sentinel approval only for what each step needs, all HTTPS (port 443):

| Step | Hosts |
| --- | --- |
| Download the skill | `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com` (GitHub release downloads redirect there) |
| Install Node.js (only if missing) | `nodejs.org` |
| Use the skill | the RPC endpoints and explorers of the chains in use, the relayer if one is used; full list by category in `assets/registry/egress.json` after installation |

Approve chain hosts per chain as they are needed (`node scripts/up.mjs chains rpc list <chain>` shows the endpoints of one chain) rather than every listed host at once.

## 2. Node.js 22 or newer

```sh
node --version
```

If it prints `v22` or higher, continue with step 3. Otherwise install Node in user space (after the human agreed):

```sh
ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; esac
mkdir -p "$HOME/.local/node" && cd "$(mktemp -d)"
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
FILE=$(grep -o "node-v22[^ ]*-linux-$ARCH.tar.xz" SHASUMS256.txt | head -n1)
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$FILE"
grep " $FILE\$" SHASUMS256.txt | sha256sum -c -
tar -xJf "$FILE" -C "$HOME/.local/node" --strip-components=1
export PATH="$HOME/.local/node/bin:$PATH"
node --version
```

Continue only if `sha256sum -c` printed `OK`. Add the `export PATH=…` line to `~/.profile` so later sessions find Node.

## 3. Download and verify the skill

Use the release version the human asked for, or the latest release listed at https://github.com/universal-everything/ai-universalprofile-skill/releases.

```sh
VERSION=0.1.0
cd "$(mktemp -d)"
curl -fsSLO "https://github.com/universal-everything/ai-universalprofile-skill/releases/download/v$VERSION/universal-profile-$VERSION.tar.gz"
curl -fsSLO "https://github.com/universal-everything/ai-universalprofile-skill/releases/download/v$VERSION/SHA256SUMS"
sha256sum -c SHA256SUMS
mkdir -p "$HOME/skills"
tar -xzf "universal-profile-$VERSION.tar.gz" -C "$HOME/skills"
ls "$HOME/skills/universal-profile/SKILL.md"
```

Stop if `sha256sum -c` does not print `OK`: the download is not the published release.

## 4. First run

```sh
cd "$HOME/skills/universal-profile"
export UP_AGENT_HOST=muse
node scripts/up-doctor.mjs
node scripts/up.mjs init
```

- `UP_AGENT_HOST=muse` tells the skill it runs inside an isolated agent VM, so the controller key is kept in a protected file inside the VM (`~/.universal-profile/keys/`, readable only by the agent's user). Add `export UP_AGENT_HOST=muse` to `~/.profile` so every later call uses the same key store.
- `up init` prints only the public controller address. Continue with `SKILL.md` ("First run") and `references/onboarding.md`.
- Never print, copy, upload or attach anything from `~/.universal-profile/keys/`. If the VM's files were ever lost, the key would be lost with them: recommend that the human adds their own wallet as a second controller right after setup.

## 5. Images

QR codes and identicons are written as PNG files and listed in the `media` field of results. Show them to the human as Muse Artifacts where possible, and always also give the text form (address, chain, amount, EIP-681 URI).

## 6. Updates

Repeat step 3 with the new version into a fresh directory, then replace `~/skills/universal-profile`. The agent's state and key live in `~/.universal-profile/`, outside the skill folder: never delete or overwrite that directory during an update. Run `node scripts/up-doctor.mjs` afterwards.
