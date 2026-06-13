# AGENTS.md

## Repo Shape
- Single-file static site: all HTML/CSS/JS in `index.html`
- Local assets used by the page:
  - `11519743-hd_1920_1080_50fps.mp4` — hero video
  - `Alicja-Barankiewicz_CV_data_engineer.pdf` — downloadable CV
- No package manager, build step, test runner, linter, or CI

## Preview
```
python3 -m http.server 4173 --directory /home/alice/portfolio
```
Open `http://localhost:4173/`

## Architecture
- Hash-router (`route()` in `<script>`) maps `#home`, `#cv`, `#projects`, `#contact`
- Page switching: `.page.active` + `body.page-open` class toggle
- `body` is non-scrolling (`overflow:hidden`); each `.page.active` scrolls internally
- Theme initialized in blocking `<head>` `<script>` before `<style>` — keep it there to prevent flash

## Editing Guardrails
- Keep nav hash links, section `id`s, and router logic in sync
- `#projects` exists as a section and route but has no nav link (intentional)
- Footer: `display:none` by default; only shown via `body.page-open footer`
- Duplicate marquee text nodes need `aria-hidden="true"` for screen readers
- Prefer CSS classes over inline `style=` attributes
- Avoid `!important` — use specificity or custom properties instead
- If adjusting footer/nav/scroll, verify overlap with `.page.active` padding
- Animation code must respect `prefers-reduced-motion`

## Hero Accent Color
- `--hero-accent` drives both `.hero-intro` headline color and the `.hero::after` radial spotlight
- Initialized randomly from `data-hero-colors` on `.portfolio-track`, then HSL-cycled at ~8 deg/s in the RAF loop
- Accent cycling pauses when a sub-page is open (`body.page-open`)

## Scroll Reveal
- IntersectionObserver-based on `.tl-item`, `.proj-card`, `.skills-cat`
- Observer is re-bound on each route change via `observeReveal()`
- 1500ms fallback timer forcibly adds `.revealed` to any items still hidden (safety net for observer failures)

## Manual Verification
- Navigation: `#` (home), `#cv`, `#projects` (no nav link), `#contact`
- Theme toggle: persistence in localStorage, `aria-pressed` state
- Keyboard: skip link, focus-visible on all interactive elements
- Responsive: desktop, ≤1024px, ≤720px, ≤480px
- Hero video autoplay (via `canplay` + retry timeouts + user-interaction events), reduced-motion mode
