# LUBA — UI/UX Engineering Master Skill

This is the governing design document for LUBA's interface. Every session that
touches UI reads this first. It combines Anthropic's frontend-design guidance,
Vercel's Web Interface Guidelines, NN/G usability heuristics, WCAG 2.2, and
Apple HIG — adapted to this product's actual decisions, not generic.

---

## Design Decision Record (locked for this product)

| Decision | Value | Reason |
|---|---|---|
| Product | Lowest-unique-bid auctions, Ethiopian market | Mobile-first, trust-critical (money) |
| Audience | Ethiopian bidders, mostly Android phones, Amharic or English | 375–430px primary viewport |
| Primary task | Place a unique low bid in <30s from the landing page | Every screen serves this or money management |
| Visual direction | **Technical/premium fintech** — deep slate surfaces, ONE cyan accent, tabular numerals | "Crypto-style wallet speed" positioning vs HowLow |
| Typography | **Inter** (ss01/cv01/cv11/tnum), Noto Sans Ethiopic for `lang="am"` | tabular digits for money tables; Fidel needs 1.6 leading |
| Color strategy | Dominant neutrals + single `--primary` cyan + semantic states only | Gradients only with a product reason (never on buttons) |
| Radius system | 12px cards (`--radius`), 8px inner controls, pills only for statuses/chips | One geometric language |
| Motion | 120–300ms, cubic-bezier(0.22,1,0.36,1), `prefers-reduced-motion` respected | Motion communicates state, never decorates |
| Density | Consumer pages calm; admin medium/high | Different products inside one app |
| Spacing | 8-pt rhythm; 4px only micro (icon↔label); 1px borders/2px rings exempt | Framework rule, not math law |
| Touch targets | 44px min on coarse pointers (exceeds WCAG 24px floor) | Ethiopia = touch devices |

## Non-negotiables (each maps to a section below)

1. **Anti-slop** — no purple-gradient hero, no three-identical-cards, no
   emoji-as-icons, no card-in-card-in-card, no decoration without a job.
2. **One decision per screen** — the primary action dominates; everything else
   is quieter (Hick's Law; this is the HowLow lesson).
3. **Every state exists** — loading (skeleton mirroring layout), empty (why +
   what to do + action), error (what/why/fix, never color alone), success.
4. **Feedback on every meaningful action** — never leave "did it work?" open.
5. **Buttons name actions** — "Pay 14.50 ETB", not "Submit"/"Okay".
6. **Placeholders are not labels**; essential instructions never live only in
   placeholders.
7. **Mono font = technical codes only** (auction codes, tx references, IDs).
   Money/stats/countdowns = Inter + tabular-nums. This was the single biggest
   source of "AI-made" feel — never regress it.
8. **Semantic color roles only** — success emerald, warning amber, danger rose,
   accent primary. No color because it looks nice; no color-only status.
9. **Focus visible** — `:focus-visible` ring in accent; never removed, never
   obscured behind sticky bars.
10. **Honest data** — no fake listings, no invented winners, no demo rows in
    production. An empty state is correct when nothing exists.

## Accessibility floor (WCAG 2.2 AA as engineering constraint)

- Text contrast ≥4.5:1 (≥3:1 large) — check muted-foreground on backgrounds.
- Keyboard: everything reachable, logical order, Escape closes overlays,
  focus trapped in dialogs and returned on close.
- Targets: 44×44 on coarse pointers; adjacent destructive actions separated.
- Forms: real `<label>`s, correct `inputMode`/`autocomplete`, inline errors
  tied to inputs (`aria-describedby`), never border-color-only.
- Status never color-only — pair with icon or text.
- `prefers-reduced-motion` disables non-essential animation.
- Images of prizes have alt text; decorative layers are `aria-hidden`.

## Workflow for any UI change in this repo

1. Read the Decision Record above — it answers style questions so we don't
   re-litigate them per screen.
2. Reuse existing components (`src/components/ui/*`, `luba.tsx` shared
   pieces) before creating anything. One design system; page-level deviation
   must be justified in a comment.
3. Squint test before finishing: is the primary action identifiable when
   everything is blurred?
4. Visual QA — never judge from source code alone. If preview tooling is
   available, look at the rendered page at 375px and 1280px.
5. Gate: `bunx tsc -b --noEmit` (frontend) and, when `src/convex/` changed,
   `bunx convex dev --once` must pass before handoff.

## Known past failures — do not repeat (living list)

- Monospace sprayed on money/labels → looked like a dev terminal. Fixed:
  Inter + tabular-nums; mono only for codes.
- Light-mode button gradient in bleeding-edge `oklch(from …)` syntax →
  rendered garbled pink on some Android browsers. Fixed: solid `--primary`.
  Rule: no syntax newer than broadly-shipped baseline in load-bearing CSS.
- `overflow-hidden` card + `.table-scroll` on the same element → Tailwind
  utility layer won, tables clipped with no scroll. Fixed: scroll container
  and rounded-card are separate elements; `.table-scroll` uses `!important`.
- 44px touch rule inflating small precision controls (Switch/Checkbox/Badge)
  → deformed controls. Fixed: exempt by `data-slot` + explicit geometry with
  invisible hit-area halos. Any new small control needs the same treatment.
- `position:fixed` children trapped by header's `backdrop-filter` containing
  block → drawer overlay wouldn't cover page. Fixed via `createPortal` to
  `document.body`. Rule: fixed overlays inside filtered ancestors must portal.
- Edge fades that never disappear → looked like cut-off content. Fixed:
  scroll-aware (`ScrollableTabs` pattern) — affordances only while content
  is actually hidden in that direction.
- `w-full` TabsList inside the scroll strip → trailing triggers spilled
  OUTSIDE the rounded pill on phones (labels scrolling over bare background).
  Fixed: `min-w-max` so the pill grows to content when it can't fit.
- Bottom-bar section navigation could select an off-screen tab; user landed
  on a hidden trigger. Fixed: `ActiveTabScroll` keeps the active tab visible
  with strip-local scroll math (never `scrollIntoView`, which yanks the page).

---

## Visual QA is a required pass — never judge from source code alone

The single workflow rule that most improves output quality: after rendering,
**look at the rendered page** (or the platform preview) at 375px and 1280px
before declaring done. The compile passing proves nothing about layout.
Inspect for: alignment drift, overflow, contrast of muted text, focus rings,
empty/loading states, long titles (`line-clamp` present?), tabular alignment
of money, mobile safe-area clearance of fixed bars.

If the preview is unavailable, re-derive the layout mentally: trace every
fixed bar against content spacing, every scroll container against its parent's
min-width, every theme's variables against every surface.

---

## Anti-pattern catalog (search for these before delivery)

Generic AI/SaaS patterns become violations only when they appear WITHOUT a
product-specific reason. Each needs a justification comment in code or a line
in a page-override doc:

- Purple/blue default gradients; Inter/Roboto chosen by inertia rather than
  decision (Luba's Inter choice IS deliberate — see Decision Record)
- Centered-everything layouts; three identical feature cards
- Card-in-card-in-card; every section boxed; borders on every element
- Glassmorphism decoration; shadows as decoration rather than elevation
- Emoji as interface icons; random icon mixing; icon without label where the
  meaning isn't universal
- Excessive badges/pills; badges used as decoration rather than state
- Random animation; animation without a state to communicate
- `#999`-class contrast on important text; color-only status
- Placeholder carrying instructions; placeholder-as-label
- Button labels: Submit / Okay / Continue / Click here (unless context makes
  the action unambiguous — e.g. a wizard's next step)
- Tiny controls; destructive next to primary without separation
- Desktop table shrunk to unreadable on mobile instead of row layout or
  priority columns
- Dashboard widgets answering no question (the 4-stat-cards + 2-random-charts
  template)

## State matrix — every data surface needs all four

| State | Requirement |
|---|---|
| Loading | Skeleton mirrors final layout; never a bare spinner for content-heavy areas |
| Empty | Why it's empty + what to do + the action as a button. No fake data. |
| Error | What happened, why (if useful), how to fix. Never color alone. |
| Success | Immediate confirmation; where relevant, the next step. |

When adding a tab, panel, or list: check it against this matrix. Missing
states are the most common gap after layout bugs.

## Component checklist (before shipping any new control)

- [ ] States: default / hover / focus-visible / active / disabled / loading
- [ ] Error and success handled (form controls)
- [ ] Accessible name (label, aria-label, or visible text)
- [ ] 44px target on coarse pointers (or `data-slot` exemption with halo)
- [ ] Token-based styling (no one-off values that duplicate a token)
- [ ] Contrast of all text on its surface ≥4.5:1 (≥3:1 large)
- [ ] Keyboard reachable; Escape closes if it's an overlay

## Final quality gate (run before declaring UI work complete)

**UX** — primary task obvious · navigation answers where-am-I / where-can-I-go
/ how-do-I-get-back · recognition over recall · cognitive load controlled ·
errors recoverable · feedback immediate.

**UI** — hierarchy (squint test) · tokens used consistently · typography
intentional (mono=codes, Inter+tnum=money) · radius language consistent ·
components reused · no decoration without a job.

**A11y** — keyboard complete · focus visible and never obscured · contrast ·
targets sized · forms labeled · status never color-only · reduced-motion
respected.

**Responsive** — 375px and 1280px coherent · no horizontal overflow · text
breaks gracefully (`line-clamp`, `truncate`, `min-w-0`) · fixed bars clear
content and each other · safe-area insets respected.

**Anti-AI** — would the interface still be recognizable with the logo removed?
If not, the identity is generic and needs work.

---

## Page overrides

Global system is law; pages deviate deliberately, with a documented reason.
Add deviations here as they arise:

- **Admin** — medium/high density, tables scroll within cards (`.table-scroll`),
  secondary actions live in overflow menus. Justified: professional operators,
  not consumer flow.
- **Landing** — the only page allowed full-bleed sections and larger display
  type. Justified: marketing surface.
- **Auction detail** — the bid bar is fixed on mobile with safe-area padding;
  content bottom-padding clears it. Justified: primary task is bidding, must
  be one thumb-reach away.

## Amharic (Fidel) overrides — mandatory when lang="am"

Ethiopic scripts need leading ≥1.6 for vowel marks above/below the Fidel, no
mid-word breaks in chips/buttons, extra horizontal padding on buttons. See
`html[lang="am"]` rules in `src/index.css`. Never tighten leading or tracking
"for style" on text that can render in Amharic.

## The Golden Rule

Never ask "what would AI generate here?" — ask "what would an exceptional
product designer create for THIS product, audience, task, and context?"
Then implement it with engineering discipline. The objective is not to look
less like AI; it is to look like someone cared enough to design it.
