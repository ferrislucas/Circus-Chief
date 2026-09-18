# UI contribution guide

Circus Chief is a dense operator console. UI changes should preserve that character while keeping controls legible and reachable across compact and wide screens.

## Use the shared visual system

- Start with the semantic tokens and shared control rules in `packages/web/src/assets/main.css`; avoid introducing route-specific colors, spacing, radii, or control heights when a shared rule fits.
- Keep normal text, state color, borders, and surface elevation distinct. Status must remain understandable without color alone.
- Prefer resilient layout primitives (`minmax(0, 1fr)`, wrapping, contained scrolling) over fixed widths. Long names, paths, branches, URLs, code, and logs are normal input.

## Responsive and interaction checklist

- Check 375 × 812 first: there must be no document-level horizontal overflow, and primary actions need a 44px target and safe-area-aware reachability.
- Check a representative 768px tablet state and a 1280px desktop state. Dense tables, diffs, logs, and Kanban boards may scroll inside their own panel, never by widening the page.
- Keep focus visible, keyboard actions working, and overlay/modals dismissible. For chat overlays, retain the visual-viewport/keyboard-inset behavior covered by `useVisualViewport` tests.
- Respect reduced-motion preferences and avoid animations that obscure state changes or block interaction.

## Required evidence for a UI change

1. Run the relevant component/unit tests and a source-served Playwright test on an isolated frontend port.
2. Where a surface is mobile-relevant, add or update a durable overflow/reachability assertion at 375 × 812; include representative screenshots only when the state is deterministic.
3. Run the matching tablet/desktop coverage, `pnpm --filter @circuschief/web build`, and `git diff --check` before handoff.
4. State any intentional overflow, browser/hardware limitation, or accepted visual tradeoff in the change summary.

The Playwright configuration currently provides Chromium-based desktop/mobile projects. WebKit/Firefox and physical iOS Safari validation require a deliberately configured environment or device run; do not represent Chromium device emulation as Safari coverage.
