# Metronome PWA

Precise Angular metronome with Web Audio scheduling, a mobile-first dark UI, song presets, setlists, drag-and-drop ordering, offline support, and GitHub Pages deployment.

## Local development

Start the dev server:

```bash
npm start
```

Build a production bundle:

```bash
npm run build
```

Run the unit tests:

```bash
npm test -- --watch=false
```

## Mobile audio

On Safari-based browsers for iPhone and iPad that expose the Audio Session API, the metronome requests `playback` mode before starting Web Audio so the click can keep playing while the device is in Silent Mode.

If the browser does not expose that API, or if iOS still refuses activation, the app now surfaces an in-app warning instead of failing silently. In that case, turn Silent Mode off and try again.

Airplane mode is supported after the app has been opened once and cached offline. The metronome click is synthesized locally, so playback does not need the network after the PWA assets are already available on the device.

## GitHub Pages deployment

This repository is configured to deploy through GitHub Actions using [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The workflow file is:

```text
.github/workflows/deploy-pages.yml
```

What it does:

1. Installs dependencies with `npm ci`.
2. Runs the unit test suite before deployment.
3. Builds Angular with the correct GitHub Pages base path from `actions/configure-pages`.
4. Copies the built `index.html` to `404.html` so Angular client-side routes work when a GitHub Pages refresh lands on `/songs` or `/setlists/...`.
5. Uploads the `dist/metronome-pwa/browser` output and deploys it to Pages.

First-time setup in GitHub:

1. Push this repository to GitHub.
2. Open the repository settings.
3. Go to `Settings > Pages`.
4. Ensure the site is configured to publish using `GitHub Actions`.
5. Push to `main` or run the workflow manually from the Actions tab.

Notes:

- For a project site, the workflow automatically builds with `/<repo-name>/` as the Angular base href.
- For a root `username.github.io` or `organization.github.io` repository, it automatically builds with `/`.
- The Pages artifact is prepared by `prepare-pages.mjs`, which adds `.nojekyll` and the SPA fallback `404.html`.

## Project structure

- `src/app/core/metronome` contains the timing engine, scheduler worker, and click synthesis.
- `src/app/features/player` contains the main player and advanced SVG visualizer.
- `src/app/features/songs` contains song preset management.
- `src/app/features/setlists` contains setlist management and drag-and-drop reordering.
- `src/app/shared/storage` contains IndexedDB and localStorage persistence.
