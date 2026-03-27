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

Consistent spacing via predefined scale:
- `xxs` (4px), `xs` (8px), `s` (12px), `m` (16px), `l` (20px), `xl` (24px), `xxl` (32px)
- Apply as padding and margins for predictable layouts

## Content Density

Two modes:
- **Comfortable** (default): More whitespace, better for general use
- **Compact**: Less whitespace, better for data-dense views

## Visual Modes

- **Light mode**: Default appearance
- **Dark mode**: Reduced luminance for low-light environments

## Layout Principles

- Responsive grid system
- Max content width for readability
- Consistent gutters between columns
- Mobile-first approach
