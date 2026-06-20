# Cloudscape Foundations Reference

Full docs: `https://cloudscape.design/foundation/index.html.md`

## Design Tokens

Cloudscape uses design tokens as abstractions of visual properties. Use CSS custom properties (variables) provided by `@cloudscape-design/global-styles`.

## Colors

Colors set the emotional tone of the UI. Follow accessibility requirements (WCAG contrast ratios).

Key color categories:
- **Background**: Page backgrounds, container backgrounds
- **Text**: Primary, secondary, disabled text
- **Border**: Container borders, dividers
- **Status**: Success (green), warning (orange), error (red), info (blue)
- **Interactive**: Primary actions, links, focus indicators

## Typography

Cloudscape typography organizes and styles information with purpose:
- Headings: h1-h5 with specific sizes and weights
- Body: Regular and small variants
- Code: Monospace for code content

## Spacing

Full docs: `https://cloudscape.design/foundation/visual-foundation/spacing/index.html.md`

Cloudscape spacing is a fixed scale built on a **4px base unit**. All spacing in a Cloudscape UI must come from this scale — never hand-write pixel gaps/paddings/margins. See the SKILL.md "Spacing & Density" section for the enforcement rules; this is the reference table.

### Token scale (named token → px)

| Token | px | Notes |
|-------|----|-------|
| `xxxs` | 2  | hairline gaps inside dense controls |
| `xxs`  | 4  | icon ↔ text, tightest inline cluster |
| `xs`   | 8  | inline groups (button rows, badge/tag clusters) |
| `s`    | 12 | related lines within one block/card |
| `m`    | 16 | default content spacing, grid gutters |
| `l`    | 20 | between sections / between list items |
| `xl`   | 24 | generous section separation |
| `xxl`  | 32 | top-level page section separation |
| (`xxxl`) | 40 | exists as a raw 40px unit; not a `SpaceBetween` size |

`SpaceBetween` `size` accepts `xxxs`–`xxl`. `Box` `padding`/`margin` accept those plus `n` (none). The underlying CSS custom properties are exposed by `@cloudscape-design/design-tokens` (e.g. `--space-scaled-l`) for the rare case you must reference one in CSS — prefer the components.

### How to apply it (Cloudscape foundation guidance)

- **Smaller tokens** tighten the relationship between elements that belong together (within a component/block).
- **Larger tokens** establish visual separation between distinct groups/sections.
- The system uses a **soft grid** (not a strict baseline grid) — consistent token usage is what produces consistent vertical rhythm, so always differentiate within-group spacing from between-group spacing.
- Apply spacing through `SpaceBetween` (gaps between siblings), `Box`/`Container` (internal padding), and `Grid`/`ColumnLayout` (column gutters) — not raw `style`/`className`.

## Content Density

Two modes:
- **Comfortable** (default): More whitespace, better for general use
- **Compact**: Less whitespace, better for data-dense views (tables, dashboards, consoles)

Set globally at runtime — never simulate compact by shrinking individual paddings:

```tsx
import { applyDensity, Density } from "@cloudscape-design/global-styles";
applyDensity(Density.Compact); // or Density.Comfortable
```

The `scaled` spacing tokens (`spaceScaled*`) shrink automatically in compact mode; `static` tokens (`spaceStatic*`) do not.

## Visual Modes

- **Light mode**: Default appearance
- **Dark mode**: Reduced luminance for low-light environments

Set globally at runtime (drive the initial value from `prefers-color-scheme`):

```tsx
import { applyMode, Mode } from "@cloudscape-design/global-styles";
applyMode(Mode.Dark); // or Mode.Light
```

Because components and design tokens resolve per mode, this re-themes the whole app — any custom CSS that references tokens (not hex values) follows automatically. See [design-tokens.md](design-tokens.md).

## Layout Principles

- Responsive grid system
- Max content width for readability
- Consistent gutters between columns
- Mobile-first approach
