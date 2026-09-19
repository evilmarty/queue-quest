# Queue Quest

A static, peer-to-peer waiting game. Players automatically join one shared queue,
wait ten seconds at the front, and then finish. Queue state is sent directly
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
source:

```sh
python3 scripts/generate_soundtrack.py
```

## Checks

```sh
npm test
npm run build
```

## Deployment

Every push to `main` builds the site and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`.

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
