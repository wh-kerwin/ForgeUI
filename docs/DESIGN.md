# Forge UI Design Direction

## Direction

Quiet dark desktop workspace inspired by Linear, Raycast and OpenCode references in `awesome-design-md`. Use a charcoal canvas, one acid-lime signal color, precise 1px borders and compact mono metadata. The product should feel like a calm instrument for turning APIs into useful screens.

## Tokens

- Canvas: `#0b0e13`
- Surface: `#111720`
- Raised surface: `#171f2b`
- Border: `#283241`
- Primary text: `#edf2fa`
- Secondary text: `#8995a7`
- Signal: `#d5fa61`
- Warning: `#f5c76b`
- Danger: `#ff7f86`
- Display type: `Manrope`, with generous negative tracking.
- Metadata: `DM Mono`, uppercase, 10–11px, letter spacing `.14em`.
- Spacing: 4px base scale (`4/8/12/16/20/24px`).
- Controls: 38px default height, 8px radius, 12px text, 16px horizontal padding.
- Focus: 2px signal outline with 2px offset for keyboard users.

## Rules

- Keep one dominant action per surface.
- Prefer cards with a clear hierarchy over long control lists.
- Use asymmetric hero composition and generous breathing room on the overview.
- Put technical configuration behind explicit settings routes.
- Use motion for generated/loading states, never for decoration that competes with data.
- All interactive targets have visible hover/focus states and at least 36px touch area.
- At widths below 640px, the sidebar becomes a compact top navigation and content uses 16px horizontal padding.
- Never use purple gradients, generic dashboard gradients, or unexplained decorative charts.
- Feedback surfaces are transient or dismissible: success toasts auto-dismiss, failures stay only until the user closes them, and in-progress indicators must be replaced by the flow's terminal state.
- Every non-progress overlay has an accessible close control; two overlays must never share the same fixed coordinates without an explicit stack or offset.
- Diagnostics show only what is still valid for the current terminal state: superseded retry errors and duplicated issues are never carried into a successful result.
