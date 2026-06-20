# Cloudscape Design Tokens Reference

Full docs: `https://cloudscape.design/foundation/visual-foundation/design-tokens/index.html.md`
Package: `@cloudscape-design/design-tokens` (531 tokens across 6 categories)

Design tokens are named key-value pairs for visual properties (color, size, font, border, motion). They are the **escape hatch** for the rare case where no Cloudscape component fits and you must write custom CSS. They are **not** a license to build custom UI — the [Golden Rule](../SKILL.md) still applies: prefer a component first.

## When (and when not) to use tokens

- ✅ Use a **component** (`SpaceBetween`, `Box`, `StatusIndicator`, `Badge`, `Container`…) — covers ~99% of needs and is always preferred.
- ✅ Use a **token** only when you genuinely must write custom CSS (a one-off layout primitive, a chart/canvas color, a third-party widget you're skinning).
- ❌ Never hard-code a hex color, px size, or font value. `color: #424650` or `padding: 14px` breaks dark mode, compact density, and future theme changes.

**The cardinal rule: match the token to the element's *semantic purpose by name*, not its current value.** Token values change between light/dark and comfortable/compact modes and across releases — the name is the stable contract. Use `colorTextStatusError` for error text because it *is* error text, not because it happens to be red today.

## Naming convention — CTI (Category · Type · Item · State)

`color-background-input-disabled` → category `color`, type `background`, item `input`, state `disabled`.
The same token has three forms; pick by where you write it:

| Context | Form | Example |
|---------|------|---------|
| JavaScript / TS (camelCase) | `awsui.colorTextBodySecondary` | resolves to a CSS `var(...)` string |
| Sass (`$kebab-case`) | `awsui.$color-text-body-secondary` | compile-time |
| Raw CSS custom property | `var(--color-text-body-secondary-…)` | the hashed suffix is generated — prefer the JS/Sass import so you never type the hash |

## Consuming tokens

```bash
npm install @cloudscape-design/design-tokens
```

```scss
// Sass — preferred for stylesheets
@use '@cloudscape-design/design-tokens/index.scss' as awsui;

.custom-panel {
  color: awsui.$color-text-body-secondary;
  background: awsui.$color-background-container-content;
  border-radius: awsui.$border-radius-container;
  padding: awsui.$space-scaled-l;          // 20px in comfortable, less in compact
}
```

```tsx
// JavaScript / inline styles / CSS-in-JS
import * as awsui from '@cloudscape-design/design-tokens';

<div style={{
  color: awsui.colorTextStatusSuccess,
  borderTop: `1px solid ${awsui.colorBorderDividerDefault}`,
}} />
```

For tooling (Style Dictionary, Figma), the values are published in DTCG format in the package's JSON export.

## Category reference (real token names)

Values below are the **light-mode / comfortable** defaults — they shift in dark mode and compact density, which is exactly why you reference the name. The catalog at the docs URL above is the complete, filterable source.

### Color — text

| Token (JS) | Purpose | Light value |
|------------|---------|-------------|
| `colorTextBodyDefault` | default body text | `#0f1b2a` |
| `colorTextBodySecondary` | secondary / muted text | `#424650` |
| `colorTextHeadingDefault` | headings | — |
| `colorTextHeadingSecondary` | sub-headings | — |
| `colorTextLabel` | form labels | — |
| `colorTextLinkDefault` / `colorTextLinkHover` | links | — |
| `colorTextStatusSuccess` | success text | `#00802f` |
| `colorTextStatusError` | error text | — |
| `colorTextStatusWarning` | warning text | — |
| `colorTextStatusInfo` | info text | — |
| `colorTextStatusInactive` | inactive/disabled status | — |
| `colorTextInteractiveDefault` / `…Hover` / `…Active` / `…Disabled` | interactive elements | — |
| `colorTextEmpty` | empty-state text | — |

### Color — background

| Token (JS) | Purpose |
|------------|---------|
| `colorBackgroundLayoutMain` | page/app background |
| `colorBackgroundContainerContent` | container body (`#ffffff` light) |
| `colorBackgroundContainerHeader` | container header strip |
| `colorBackgroundInputDefault` | input fields |
| `colorBackgroundDropdownItemDefault` / `…Hover` / `…Selected` | dropdown items |
| `colorBackgroundItemSelected` | selected row/item |
| `colorBackgroundCellShaded` | zebra/shaded table cell |
| `colorBackgroundButtonPrimaryDefault` / `…Hover` / `…Active` / `…Disabled` | primary button |

### Color — border / divider

`colorBorderDividerDefault`, `colorBorderDividerSecondary`, `colorBorderContainerTop`, `colorBorderInputDefault`, `colorBorderInputFocused`, `colorBorderItemFocused`, `colorBorderStatusError` / `…Success` / `…Warning` / `…Info`.

> There are also **chart color tokens** (`colorChartsRed300`…`colorChartsBlue1200`, etc.) — use these for custom data visualizations instead of inventing a palette.

### Typography

| Group | Tokens |
|-------|--------|
| Font family | `fontFamilyBase`, `fontFamilyHeading`, `fontFamilyDisplay`, `fontFamilyMonospace` |
| Font size | `fontSizeBodyS`, `fontSizeBodyM` (14px), `fontSizeHeadingXs`/`Xs`/`S`/`M`/`L`/`Xl`, `fontSizeDisplayL` |
| Font weight | `fontWeightNormal`, `fontWeightBold`, `fontWeightHeavy`, `fontWeightLighter`, `fontWeightHeadingS`…`Xl`, `fontWeightButton` |
| Line height | `lineHeightBodyS`, `lineHeightBodyM`, `lineHeightHeadingXs`…`Xl`, `lineHeightDisplayL` |

### Spacing

Two families share the `xxxs`–`xxxl` scale (the SKILL.md spacing ladder maps to these):
- **Scaled** (responds to compact density) — `spaceScaledXxxs`, `spaceScaledXxs`, `spaceScaledXs`, `spaceScaledS`, `spaceScaledM`, `spaceScaledL` (20px), `spaceScaledXl`, `spaceScaledXxl`, `spaceScaledXxxl`. Use for layout gaps/padding.
- **Static** (fixed regardless of density) — `spaceStaticXxxs`…`spaceStaticXxxl`. Use when a gap must not shrink in compact mode.
- Component-semantic spacing also exists (`spaceContainerHorizontal`, `spaceFieldVertical`, `spaceButtonHorizontal`…) for matching a component's own internal rhythm.

> In practice you almost never write these — `SpaceBetween`/`Box` apply them for you. See SKILL.md → **Spacing & Density**.

### Borders — radius

`borderRadiusContainer` (16px), `borderRadiusButton`, `borderRadiusInput`, `borderRadiusDropdown`, `borderRadiusBadge`, `borderRadiusItem`, `borderRadiusPopover`, `borderRadiusAlert`, `borderRadiusFlashbar`, `borderRadiusCardDefault`, `borderRadiusChatBubble`, `borderRadiusTiles`, `borderRadiusToken`. (Plus focus-ring radii like `borderRadiusControlDefaultFocusRing`.)

### Shadows & other

`shadowCard`, `shadowContainerActive`. Plus input height and a few special values.

### Motion

- Durations: `motionDurationResponsive`, `motionDurationExpressive`, `motionDurationComplex`, plus avatar/gen-ai-specific ones.
- Easing: `motionEasingResponsive`, `motionEasingExpressive`, `motionEasingSticky`.
- Keyframes: `motionKeyframesFadeIn`, `motionKeyframesFadeOut`, `motionKeyframesScalePopup`.

Respect reduced-motion: Cloudscape disables animation when the OS prefers reduced motion — using these tokens inherits that behavior for free; hand-rolled CSS transitions do not.

## Theming & modes

- **Light/Dark** and **Comfortable/Compact** are applied globally via `@cloudscape-design/global-styles` `applyMode`/`applyDensity`. Because your custom CSS references tokens (not values), it follows the active mode automatically.
- **Custom themes**: `@cloudscape-design/theming-runtime` / `@cloudscape-design/theming-build` let you override themeable tokens for branded experiences — tokens marked themeable in the docs accept runtime overrides.
