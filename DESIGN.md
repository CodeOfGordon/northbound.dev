# Design

Visual system for **Northbound** — a calm, dense, dark tech-events feed. Captured from the
live implementation (`app/globals.css`, `app/layout.tsx`, `components/*`). References:
lu.ma (date-grouped density), Linear (restraint, type hierarchy), Vercel (dark technical
polish). Theme is **dark-only** by design — there is no light mode.

## Theme

- **Mode:** dark-only. Near-black cool-neutral surfaces; no `.dark`/`.light` toggle ships.
- **Strategy:** restrained. Tinted-neutral surfaces + a single mint accent used sparingly,
  plus one amber role reserved for "official company event". Color is information, not
  decoration.
- **Mood:** quiet depth. A single soft mint radial glow and a faint masked grid sit behind
  the page (`components/Backdrop.tsx`); everything else is flat, dark, and legible.

## Color

OKLCH is used for `--destructive`; the core surface/text ramp is authored as hex (kept
as-is — identity preservation). Tokens live in `:root` and are exposed to Tailwind v4 via
`@theme inline`.

### Surfaces (cool near-black scale)
| Token | Value | Role |
|---|---|---|
| `--background` | `#0a0b0d` | Page background (also `themeColor` + sticky-header tint at 90%) |
| `--color-dark-100` | `#121419` | Card / panel surface |
| `--color-dark-200` | `#1e222b` | Raised surface, hover, muted/secondary |
| `--color-dark-300` | `#2a2f3a` | Raised-2 |
| `--popover` | `#14171d` | Popover surface (filters) |
| `--color-border-dark` | `#1c2028` | Hairline borders (`--border`, `--input`) |

### Text
| Token | Value | Role |
|---|---|---|
| `--foreground` | `#f4f5f6` | Headings / primary on background |
| `--color-light-100` | `#e4e6ea` | Primary body text on cards |
| `--color-light-200` | `#888f9d` | Muted / meta text, icons, labels |

### Accents (used sparingly — each carries meaning)
| Token | Value | Meaning |
|---|---|---|
| `--color-primary` (mint) | `#59deca` | Brand accent: CTAs, hackathon lane, links, focus ring, "Free", active filters |
| `--primary-foreground` | `#04110e` | Ink on mint fills |
| `--color-amber` | `#fcd34d` | Reserved: "official company event" lane |
| `--color-blue` | `#8fd9ff` | Secondary accent (sparse) |
| `--destructive` | `oklch(0.62 0.21 25)` | Errors |

**Lane accent system** (`components/EventCard.tsx`): company → amber dot + amber hover
border; hackathon → mint; local → `light-200`. Accent is a small dot + hover-border tint,
never a heavy colored side-stripe.

> **A11y watch:** `--color-light-200` (`#888f9d`) on `#0a0b0d` is the muted/meta color and
> sits near the AA 4.5:1 line; on lighter card surfaces (`dark-100/200`) it drops below.
> This is the single most likely contrast gap — see the audit. Mint `#59deca` and amber
> `#fcd34d` both pass large-text/UI contrast on dark; primary CTA text uses dark ink.

## Typography

Two families on a real contrast axis — geometric/humanist sans for reading, monospace for
technical meta. Loaded via `next/font/google` with `display: swap`; body sets
`font-feature-settings: "ss01", "cv01"`.

- **`--font-schibsted-grotesk`** (Schibsted Grotesk) — display + UI. All headings, buttons,
  labels-as-titles. `tracking-tight` on headings.
- **`--font-martian-mono`** (Martian Mono) — meta/technical: dates, counts, day numbers,
  the `.label` micro-label, the `.label` eyebrow.

### Scale
| Element | Spec |
|---|---|
| `h1` | `text-5xl` (≈3rem) semibold, `tracking-tight`, `max-sm:text-[2rem]` |
| `h2` | `text-2xl` semibold tracking-tight |
| `h3` | `text-xl` semibold tracking-tight |
| Hero | `h1` + `.text-gradient` (white→light-200 clip) + `text-balance`, `max-w-3xl` |
| Subheading | `.subheading` — `text-lg` `leading-relaxed` `max-w-2xl`, `light-200` |
| `.label` | Martian Mono `10px` uppercase `tracking-[0.12em]` `light-200` (meta micro-label) |
| Body/meta | `text-sm` / `text-xs`; card meta in mono `text-xs` |

> **Note:** `.text-gradient` is a clip-text gradient confined to the single hero `h1` (a
> deliberate white→muted fade, not multi-hue). The skill bans decorative gradient text;
> this one instance is the hero treatment — flag for review if it spreads.

## Spacing & Layout

- **Container:** `main` = `container mx-auto px-5 py-12 sm:px-8`. Sections stack with large
  gaps (`gap-24` home, `gap-20` feed groups) for rhythm.
- **Radius:** `--radius: 0.75rem` (12px). Scale: `sm` 8 / `md` 10 / `lg` 12 / `xl` 16px.
  Cards `rounded-xl` (12), pills/chips full. No over-rounding (≤16 on cards).
- **Grids:** responsive auto-fit card grids; home carousels are horizontal rails
  (`.no-scrollbar`). The `/events` feed is a **date-grouped timeline** (`EventTimeline`):
  sticky left date rail (`sm:w-28`, `sm:sticky sm:top-24`) + dense `EventRow` list.
- **Elevation:** `.card-shadow` = inset top highlight + soft `0 8px 30px -12px` drop. One
  defined shadow, not stacked.

## Components

| Class / Component | Description |
|---|---|
| `.chip` | Small rounded tag: `border-border-dark bg-dark-100`, full-radius, `text-xs` |
| `.pill` | Larger interactive pill (filters, company links): bordered, `text-sm`, hover-tint |
| `.seg` / `.seg-active` | Segmented-control buttons (lane tabs); active = `bg-dark-200` + shadow |
| `.field` | Form control (selects): bordered, mint focus ring (`focus:ring-primary/20`) |
| `.glass` | Sticky-header surface — **solid** `bg-[#0a0b0d]/90` + bottom border (NOT backdrop-blur; blur was removed for scroll perf) |
| `EventCard` | Image-forward feed card: scrim over scraped image, date chip TL, lane label TR, mono meta |
| `EventRow` | Dense timeline row (the `/events` feed primitive) |
| `EventTimeline` | Date-grouped feed with sticky date rail |
| `Carousel` / `SectionRail` | Horizontal home rails with hidden scrollbar |
| `FilterBar` | One "Filters" pill → popover of selects + removable active-filter chips; URL-synced |
| `Navbar` / header | Sticky `z-50` solid bar: logo + lane links |
| `FreshnessBadge` | "Updated X ago" trust indicator (hero + footer) |
| `EventImage` | Plain `<img>` (weserv-proxied/resized WebP) + static placeholder + DOM opacity fade + icon fallback |

> **Cards used deliberately**, not as a reflex: the home uses image-forward cards in rails,
> but the primary `/events` browse surface is a dense timeline of rows, not a card grid —
> which is the right affordance for fast scanning.

## Motion

Intentional and compositor-friendly; layout properties are not animated.

- **Smooth scroll:** Lenis (`components/SmoothScroll.tsx` + `.lenis` styles). **Live.**
- **Image load:** `EventImage` uses a static `bg-dark-200` box + a plain DOM `opacity` fade on
  decode. The old `.reveal` scroll-timeline CSS and `.skeleton-overlay` shimmer keyframes (both
  dead — never wired to any element) have been removed from `globals.css`.
- **Hover:** card image `scale-[1.03]` over 500ms; color-only transitions elsewhere. **Live.**
- **Reduced motion:** honored throughout (Lenis skips under `prefers-reduced-motion`).
- **Backdrop:** static radial glow + masked grid — no canvas/WebGL (the old `ogl` LightRays
  was removed for scroll perf; the unused `ogl` dependency has since been uninstalled).

## Iconography

`lucide-react` (thin line icons), sized `size-3.5`/`size-4` inline with text, `aria-hidden`
when decorative. Country flags as emoji (`aria-hidden`). Plus committed SVGs in
`public/icons/` (calendar, clock, pin, audience, mode, arrow-down) and `logo.png`.

## Anti-patterns avoided / to watch

- **Avoided:** side-stripe accents (uses dot + hover border), nested cards, glassmorphism
  as default (header blur was deliberately removed), bounce easing, over-rounding,
  per-section eyebrow/numbered scaffolding, hero-metric template.
- **Watch (flagged for audit):** the single hero clip-text gradient — still the one kept
  gradient, unchanged.
- **Fixed:** the unused `ogl` dependency has been uninstalled; the dead `.reveal`/
  `.skeleton-overlay`/`cv-card`/`cv-row` CSS has been removed from `globals.css`; the
  opacity-modified `light-200` contrast failures (Footer `/80`, SearchBox placeholder `/60`)
  are now solid colors and pass AA.
- Hackathon badges (application-status, travel-reimbursement) reuse the existing chip/
  Free-badge/`.label` primitives — no new tokens or components were introduced for them.
