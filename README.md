# Queue Quest

Play it at **<https://marty.zalega.me/queue-quest/>**. Open it in two browsers to
see the queue form — with only one player you go straight to the front.

A static, peer-to-peer waiting game. Players automatically join one shared queue,
then spend ten seconds at the front making everybody else wait — with the option
to extend that turn in five second increments. Queue state is sent directly
between browsers over WebRTC using [Trystero](https://trystero.dev/).

Public signaling infrastructure is used only to help browsers discover one
another and establish WebRTC connections. There is no application server and no
queue state is stored remotely.

Localhost development rewrites mDNS host candidates to the loopback address.
Some browser combinations still require a TURN relay even on the same machine.

## Development

```sh
npm install
npm run dev
```

Open the site in multiple browser profiles or devices to test the shared queue.

### TURN setup

If the interface reports that a direct connection failed, register with a TURN
provider such as Metered Open Relay and copy `.env.example` to `.env.local`:

```sh
cp .env.example .env.local
```

Set the comma-separated TURN URLs, username, and credential supplied by the
provider, then restart `npm run dev`. `.env.local` is ignored by Git and must
never be committed. Browser-delivered TURN credentials are visible to clients;
production deployments should use short-lived credentials issued by a trusted
backend or edge function.

The original intro, continuation loop, and victory fanfare are generated from
source and encoded as MP3, which requires [ffmpeg](https://ffmpeg.org)
(`brew install ffmpeg`):

```sh
python3 scripts/generate_soundtrack.py
```

MP3 is not a sample-exact format: encoders add a granule of decoder delay and
trailing padding. Chromium and Firefox honour the gapless headers and discard
both, but WebKit returns them, which would inject roughly 60ms of silence into
every loop iteration. `src/music.ts` therefore trims each decoded buffer back
to its authored length so the intro flows into the loop seamlessly. The frame
counts in `src/music.ts` must stay in sync with the generator if the tempo or
bar count changes.

The background and the app icons are pixel art generated from source, which
requires [Pillow](https://python-pillow.org) (`pip install Pillow`):

```sh
python3 scripts/generate_background.py
python3 scripts/generate_icons.py
```

`generate_icons.py` writes the icons and favicon into `public/`, alongside
`public/manifest.json`, which makes the game installable to a home screen.
Every exported size is a whole multiple of the 32px authoring grid so the art
is never sampled at a fractional offset. The manifest also ships a maskable
icon, which insets the castle far enough to survive being cropped to a circle.

Paths inside `manifest.json` are relative to the manifest itself, so they
resolve correctly from both the local root and the `/queue-quest/` base used on
Pages. The tags in `index.html` use Vite's `%BASE_URL%` for the same reason.

## Checks

```sh
npm test
npm run build
```

## Deployment

Every push to `main` builds the site and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`, which serves it at
<https://marty.zalega.me/queue-quest/>.

Because project sites are served from `/<repo>/`, the workflow sets
`GITHUB_PAGES_BASE` so Vite emits the correct asset paths. Local builds keep the
default `/` base, so `npm run dev` and `vite preview` are unaffected.

### Enabling Pages

In the repository settings, under **Pages**, set **Source** to **GitHub
Actions**. The first push to `main` then publishes the site.

### TURN credentials in CI

TURN credentials are optional. Without them the game still works whenever
browsers can reach each other directly, and falls back to a message asking for
TURN configuration when they cannot.

To supply them, add `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and
`VITE_TURN_CREDENTIAL` as repository secrets. Note that anything baked into a
static build is readable by visitors, so use short-lived credentials rather than
long-lived ones.

