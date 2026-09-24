# Exposure

Browse the photos on your NAS from any browser or phone, without uploading them anywhere.

## Set up (3 steps)

1. **Run it on your NAS** (image: `ghcr.io/nphilou/exposure`, amd64 + arm64):
   ```bash
   docker run -d --name exposure --restart unless-stopped -p 8787:8787 \
     -v /volume1/photos:/media:ro -v exposure-data:/data ghcr.io/nphilou/exposure:latest
   ```
   (`/volume1/photos` = the share that contains your photos. It is mounted read-only.)
   Or use `docker-compose.yml`: `EXPOSURE_MEDIA_DIR=/volume1/photos docker compose up -d`.
2. **Open `http://<nas-ip>:8787`** and enter the setup code shown in the container logs
   (`docker logs exposure`). This proves you own the server. Then pick your photo folder.
3. **Add your phone:** in the app go to Settings → Devices → *Add a device* and scan the QR code.
   Every device gets its own token you can revoke.

Lost access to every device? Restart the container once with `-e EXPOSURE_RESET_AUTH=1`
(removes all paired devices, prints a new setup code), then start it again without it.

**Updating:** pull `ghcr.io/nphilou/exposure:latest` again and recreate the container
(`docker compose pull && docker compose up -d`). Settings, library and paired devices live in `/data` and are kept.
New images are built by GitHub Actions on every push to `main`; tag `vX.Y.Z` for a versioned release.

## Using it away from home

Exposure has no cloud relay, so the server must be reachable. Options, easiest first:

- **Tailscale** (private, HTTPS, no open ports): `TS_AUTHKEY=... docker compose --profile tailscale up -d`,
  install Tailscale on your phone, and set `EXPOSURE_PUBLIC_URL` to your `https://exposure.<tailnet>.ts.net` address
  so pairing QR codes point there. *(compose profile not yet tested against a real tailnet)*
- **Cloudflare Tunnel**: run `cloudflared` pointing at `http://exposure:8787`; set `EXPOSURE_PUBLIC_URL` to the tunnel URL.
- Port forwarding + reverse proxy with HTTPS. Don't expose plain `http://` to the internet.

Plain `http://` works on your home network. iOS and installable web apps need HTTPS for full features.

## How it maps the folder

```
/Images/2026-09-22 Akita Show/DSC01234.ARW      → "Original" (RAW: ARW RAF CR3 NEF DNG)
                              DSC01234.JPG      → "Camera"
                              Export/DSC01234.jpg → "Edited"   (preferred version)
```
Files with the same name become one photo. Exposure never writes to the folder; favorites, albums
and paired devices live in its own SQLite DB (`/data/exposure.db`).

## Other ways to connect
Instead of mounting a folder you can point Exposure at a NAS over **WebDAV** (must be enabled on the NAS)
from the setup screen. Mounting is faster and gives live folder watching. SMB is not supported.

## iPhone app (`ios/`)
SwiftUI, iOS 18+. Pairs by scanning the QR from Settings → Devices (or typing address + code), then uses a
per-device bearer token stored in the Keychain.
```bash
cd ios && xcodegen generate && open Exposure.xcodeproj   # set your signing team to run on a device
xcodebuild test -scheme Exposure -destination 'platform=iOS Simulator,name=iPhone 16'
```
Debug builds accept launch env vars for simulator testing without taps: `EXPOSURE_PAIR=<pairing URL>`,
`EXPOSURE_TAB=shoots|albums`, `EXPOSURE_OPEN=viewer|info|search` (see `ios/Exposure/App/DebugHooks.swift`).

## Develop
```bash
npm install
npm -w server run seed                    # fake library in ./photos
EXPOSURE_LOCAL_ROOT=./photos npm run dev  # API :8787 (prints the setup code), UI :5173
```
`web/` is React + TypeScript + Vite; `server/` is Fastify + `node:sqlite` + sharp.

## Not done yet
- Full-size RAW previews (currently the small embedded thumbnail); FTS5 search
- Album create/edit UI (API exists); iOS offline mode (saved previews when the NAS is unreachable)
- Optional OIDC sign-in
