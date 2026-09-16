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
