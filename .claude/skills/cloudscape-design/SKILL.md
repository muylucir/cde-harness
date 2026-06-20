---
name: cloudscape-design
description: >
  ALWAYS invoke for React UI development targeting cloud or AWS management — regardless of the language of the request.
  This is the primary skill for: AWS console-style layouts (top nav, side nav, breadcrumbs), resource tables with
  filtering/sorting/pagination, multi-step wizard forms, CRUD pages, settings/configuration panels, admin dashboards,
  detail views, and AI streaming chat interfaces in React. Mandatory when the request mentions Cloudscape or
  @cloudscape-design in any language. Skip only for: Vue, Angular, React Native, backend/infrastructure work
  (CDK, boto3, Terraform, Grafana), or requests that explicitly name another UI library (Ant Design, Material UI,
  Vuetify, Tailwind).
---

# Cloudscape Design System

Build React UIs with AWS's open-source Cloudscape Design System (100+ components, 73 patterns).

## Golden Rule: Use Cloudscape Components, Never Reinvent

Cloudscape already provides components for virtually every UI need in cloud applications. Before writing any custom CSS, custom styled-components, or hand-rolled UI elements, check if a Cloudscape component exists for that purpose.

**Why this matters:** Cloudscape components handle accessibility (WCAG), responsive design, dark mode, keyboard navigation, and content density automatically. Custom components lose all of this and create inconsistency.

Common mistakes to avoid:
- Custom status badges → Use `StatusIndicator`
- Custom card layouts with CSS grid → Use `Cards` or `Board`/`BoardItem`
- Custom modal/dialog → Use `Modal`
- Custom dropdown menus → Use `ButtonDropdown` or `Select`
- Custom tabs → Use `Tabs`
- Custom breadcrumbs → Use `BreadcrumbGroup`
- Custom notification banners → Use `Flashbar` or `Alert`
- Custom loading spinners → Use `Spinner`, `ProgressBar`, or `LoadingBar`
- Custom tooltips → Use `Popover`
- Custom key-value display → Use `KeyValuePairs`
- Custom spacing utilities → Use `SpaceBetween` and `Box`
- Custom chat UI → Use `ChatBubble`, `Avatar`, `PromptInput`
- Custom draggable grid → Use `Board` and `BoardItem`
- Custom code blocks → Use `CodeView`
- Custom file upload → Use `FileUpload` or `FileDropzone`

If you're about to write `styled.div`, `className={styles.xxx}`, or raw HTML elements for layout/display, stop and look for the Cloudscape equivalent first. Fetch the component catalog at `https://cloudscape.design/components/index.html.md` if unsure.

**If — after exhausting components — you genuinely must write custom CSS, use design tokens, never hard-coded values.** Hard-coded hex colors, px sizes, or font values break dark mode, compact density, and theming. Reference tokens from `@cloudscape-design/design-tokens` by their semantic name (e.g. `awsui.colorTextStatusError`, not `#d91515`). See [references/design-tokens.md](references/design-tokens.md).

## Installation

```bash
npm install @cloudscape-design/components @cloudscape-design/global-styles @cloudscape-design/collection-hooks
```

Apply global styles at app root:

```tsx
import "@cloudscape-design/global-styles/index.css";
```

### Dark mode & content density (runtime)

Never hand-build a dark theme or "compact" view — Cloudscape toggles both at runtime via `@cloudscape-design/global-styles`. Because components and tokens follow the active mode, one call re-themes the whole app.

```tsx
import { applyMode, applyDensity, Mode, Density } from "@cloudscape-design/global-styles";

applyMode(Mode.Dark);            // Mode.Light | Mode.Dark
applyDensity(Density.Compact);   // Density.Comfortable (default) | Density.Compact
```

Drive these from a user setting (and `prefers-color-scheme` for the initial value). `Compact` density is the right tool for data-dense console screens — don't simulate it by shrinking individual paddings. (See [references/foundations.md](references/foundations.md) → Content Density.)

## Documentation Access

Fetch live docs from cloudscape.design when you need detailed component APIs or pattern guidance:

- **Component guidelines**: `https://cloudscape.design/components/{name}/index.html.md`
- **Component API (props/events/slots)**: `https://cloudscape.design/components/{name}/index.html.json`
- **Pattern details**: `https://cloudscape.design/patterns/{path}/index.html.md`
- **All components list**: `https://cloudscape.design/components/index.html.md`
- **All patterns list**: `https://cloudscape.design/patterns/index.html.md`
- **Demos with source**: `https://cloudscape.design/demos/index.html.md`
- **Collection hooks guide**: `https://cloudscape.design/get-started/dev-guides/collection-hooks/index.html.md`
- **All GenAI patterns**: `https://cloudscape.design/gen-ai/patterns/index.html.md` (separate `gen-ai/` base — the older `patterns/genai/...` URLs 404; see [references/patterns.md](references/patterns.md))
- **Full doc index for LLMs**: `https://cloudscape.design/llms.txt` (every component, pattern, foundation, and dev guide with descriptions)

Dev guides worth fetching when the task calls for them (under `https://cloudscape.design/get-started/dev-guides/{topic}/index.html.md` unless noted):

- **i18n** — `get-started/for-developers/internationalization/index.html.md`. Cloudscape ships i18n; wrap the app in `I18nProvider` with a locale messages bundle rather than hard-coding English strings.
- `z-index` — stacking model; relevant when overlays/modals/dropdowns layer incorrectly (pairs with `expandToViewport`).
- `responsive-development` — breakpoints and responsive props (`Grid` `gridDefinition`, `ColumnLayout`).
- `state-management` — recommended patterns for controlled Cloudscape components.
- `csp` — Content Security Policy setup (Cloudscape injects styles; needs a nonce/style-src config).

Before implementing a complex component, fetch its guidelines and API JSON for accurate props.

## Critical Gotcha: Dropdowns Clipped Inside Containers (`expandToViewport`)

**This is the #1 cause of broken Cloudscape pages.** By default, a dropdown's height is constrained to fit inside its nearest scrollable ancestor. When you place `Select`, `Multiselect`, `Autosuggest`, `DatePicker`, `DateRangePicker`, `ButtonDropdown`, or `PropertyFilter` inside a `Table`, `Modal`, `SplitPanel`, `Cards`, or any scrollable/overflow-hidden `Container`, the popover gets clipped — it collapses into a thin sliver with a scroll-stepper instead of expanding over the page.

**Fix: always set `expandToViewport` on dropdown components used inside these containers.** It renders the dropdown through a React Portal with fixed positioning, so it floats above the layout.

```tsx
// ❌ WRONG — dropdown gets clipped inside a Table cell / Modal / SplitPanel
<Select selectedOption={value} onChange={({ detail }) => setValue(detail.selectedOption)} options={options} />

// ✅ CORRECT — dropdown expands over the page
<Select
  selectedOption={value}
  onChange={({ detail }) => setValue(detail.selectedOption)}
  options={options}
  expandToViewport
/>
```

Applies equally to `Multiselect`, `Autosuggest`, `DatePicker`, `DateRangePicker`, `ButtonDropdown`, and `PropertyFilter`. When in doubt — if the dropdown lives anywhere inside a `Table`, `Modal`, `SplitPanel`, or `Cards` — set `expandToViewport`.

### Inline-edit dropdown in a Table cell (most common case)

Use the column's `editConfig` and set `expandToViewport` on the editor's `Select`:

```tsx
const COLUMN_DEFINITIONS = [
  {
    id: "status",
    header: "Status",
    cell: (item) => <StatusIndicator type={item.status}>{item.statusText}</StatusIndicator>,
    editConfig: {
      ariaLabel: "Status",
      editingCell: (item, { currentValue, setValue }) => {
        const options = [
          { value: "in-progress", label: "진행 중" },
          { value: "done", label: "완료" },
        ];
        return (
          <Select
            autoFocus
            expandToViewport          // ← REQUIRED: without this the dropdown is clipped by the table
            selectedOption={options.find(o => o.value === (currentValue ?? item.status)) ?? null}
            onChange={({ detail }) => setValue(detail.selectedOption.value)}
            options={options}
          />
        );
      },
    },
  },
];
```

## Spacing & Density: One Token Scale, No Magic Numbers

**If `expandToViewport` is the #1 cause of *broken* Cloudscape pages, hand-written spacing is the #1 cause of *ugly* ones.** The most common way a Cloudscape UI gets visually "ruined" is not wrong components — it's ad-hoc padding and gaps: a `<div style={{ marginBottom: 14 }}>` here, a `gap: 10px` there, a `padding: 6px` on a custom chip. Each looks fine alone; together they destroy vertical rhythm and make the page feel hand-assembled.

**The rule: never type a raw pixel value for spacing.** Cloudscape spacing is a fixed scale built on a 4px base unit. Every gap, every padding, every margin must be one token from this scale — applied through a Cloudscape spacing component, never through `style`/`className`.

### The spacing scale (these are the ONLY allowed gaps)

| Token | px  | Typical use |
|-------|-----|-------------|
| `xxxs` | 2  | hairline gaps inside a dense control |
| `xxs`  | 4  | icon ↔ text, tightest inline cluster |
| `xs`   | 8  | inline groups: button rows, badge/tag clusters |
| `s`    | 12 | related lines within one block/card |
| `m`    | 16 | default content spacing, grid gutters |
| `l`    | 20 | **between sections / between list items** |
| `xl`   | 24 | generous section separation |
| `xxl`  | 32 | top-level page section separation |

`SpaceBetween` accepts `xxxs`–`xxl`. `Box` `padding`/`margin` accept those plus `n` (none).

**Core principle (from Cloudscape foundations):** *smaller* tokens tighten the relationship between elements that belong together; *larger* tokens separate distinct groups. The single biggest fix for the "messy" look is **differentiating within-group spacing from between-group spacing** — they must not be the same value.

### The four spacing mechanisms — use these, nothing else

| Need | Use | Never |
|------|-----|-------|
| Gap between stacked/inline siblings | `SpaceBetween size={token} direction=…` | `marginBottom`, `gap`, `<br/>`, empty divs |
| Padding inside a region | `Box padding={token}` / `Container` (has its own padding) | `style={{ padding }}` |
| Multi-column layout | `Grid` / `ColumnLayout columns={n}` | CSS grid / flex with px gaps |
| Group a content section | `Container` (+ `Header`) | `styled.div` with border/padding |

If you reach for `style={{ padding/margin/gap }}` or a CSS class to space things, stop — one of the four above replaces it.

### The spacing ladder (context → token)

- **Between top-level page sections / Containers** → `SpaceBetween size="l"` (20) — this is the default content rhythm `AppLayout` itself uses.
- **Form fields inside a Container** → `SpaceBetween size="l"`. `FormField` already owns the label↔control gap — never add manual spacing there.
- **Related lines within one block / card / list item** → `SpaceBetween size="s"` (12) or `xs` (8).
- **Inline button group** (form/modal/header actions) → `SpaceBetween direction="horizontal" size="xs"`.
- **Inline badge/tag/status cluster, icon+text** → `SpaceBetween direction="horizontal" size="xs"` (8) or `xxs` (4).
- **Internal padding you genuinely must set** → `Box padding={{ vertical: "s", horizontal: "m" }}` — tokens, never px.

### Vertical-rhythm rules

1. **One spacing owner per nesting level.** A group of siblings gets exactly one `SpaceBetween`; do not also put margins on the children. Stacked margins are what make gaps unpredictable.
2. **Nest `SpaceBetween` to express hierarchy.** Outer list uses a large token (`l`), each item's internal lines use a small token (`s`/`xs`). This single pattern is what the broken example below is missing.
3. **Never set `margin`/`marginBottom` on a Cloudscape component.** Let the parent `SpaceBetween` own the gap.
4. **Don't fake structure with empty `<div>`s, `<br/>`, or `&nbsp;`.** Use a token gap or a `Container`.
5. **Pick density once, globally.** Use `Comfortable` (default) or `Compact` content density via the global mode — don't simulate "compact" by shrinking individual paddings.

### Worked example — the "agent activity" feed (fixing the design.png case)

The screenshot's problem isn't the components — it's that custom-colored pills, hand-spaced rows, and a manually laid-out cost summary use arbitrary, undifferentiated gaps. Here is the same UI rebuilt with the token scale. Note the **two nested `SpaceBetween` levels** (`l` between agents, `xs`/`s` within an agent) and that every colored chip is a `Badge`, status is `StatusIndicator`, and the summary is `KeyValuePairs` — no `style` anywhere.

> This is a chronological agent-activity feed, which Cloudscape formalizes as the **Timeline overview** GenAI pattern (`gen-ai/patterns/timeline-overview`), built on the **`Steps`** component. For a true event timeline, prefer `Steps` (it gives status icons + connector rail for free) over the hand-rolled rows below; the `SpaceBetween`/`Badge` version here exists to make the spacing rule concrete. Fetch the pattern doc before building a production version.

```tsx
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";

// Map your categories onto Badge's color tokens — never invent custom pill colors.
const ROLE_COLOR = { 관측: "blue", 변경: "grey", RCA: "red" };       // Badge: blue|grey|green|red|severity-*
const MODEL_COLOR = { haiku: "grey", sonnet: "blue", opus: "red" };

function AgentActivity({ agents, cost }) {
  return (
    <Container header={<Header variant="h2">에이전트 활동</Header>}>
      {/* LEVEL 1 — between agent blocks: large, even rhythm */}
      <SpaceBetween size="l">
        {agents.map((a) => (
          // LEVEL 2 — within one agent block: tight, so the lines read as a unit
          <SpaceBetween key={a.id} size="s">
            {/* header row: role + name + status + model, tightly grouped inline */}
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <Badge color={ROLE_COLOR[a.role]}>{a.role}</Badge>
              <Box fontWeight="bold">{a.name}</Box>
              <StatusIndicator type="success">완료</StatusIndicator>
              <Badge color={MODEL_COLOR[a.model]}>{a.model}</Badge>
            </SpaceBetween>

            {/* tool tags: one horizontal SpaceBetween owns every gap */}
            <SpaceBetween direction="horizontal" size="xs">
              {a.tools.map((t) => <Badge key={t} color="grey">{t}</Badge>)}
            </SpaceBetween>

            {/* the "▶ 상세" toggle is ExpandableSection, not a custom caret + div */}
            <ExpandableSection headerText="상세" variant="footer">
              {/* detail content */}
            </ExpandableSection>
          </SpaceBetween>
        ))}

        {/* cost summary: columns via KeyValuePairs, NOT hand-spaced divs */}
        <Box>
          <Header variant="h3">비용 요약</Header>
          <KeyValuePairs
            columns={3}
            items={[
              { label: "총 토큰", value: cost.tokens },
              { label: "총 비용", value: cost.usd },
              { label: "총 지연", value: cost.latency },
            ]}
          />
        </Box>
      </SpaceBetween>
    </Container>
  );
}
```

```tsx
// ❌ WRONG — what produces the inconsistent look in design.png
<div style={{ marginBottom: 18 }}>
  <span style={{ background: "#7c3aed", padding: "2px 6px", borderRadius: 4 }}>관측</span>
  <b style={{ marginLeft: 8 }}>A-OBS</b>
  <span style={{ marginLeft: 10, color: "green" }}>✓ 완료</span>
  <span style={{ background: "#333", padding: "2px 8px", marginLeft: 12 }}>haiku</span>
</div>
<div style={{ display: "flex", gap: 6, marginTop: 6 }}>
  <span className="tag">getMetrics</span>
</div>
// Every number (18, 8, 10, 12, 6) is a guess → no rhythm, no dark-mode, no a11y.
```

## Page Layout Architecture

Every Cloudscape page starts with `AppLayout`:

```tsx
import AppLayout from "@cloudscape-design/components/app-layout";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";

// TopNavigation goes OUTSIDE AppLayout, at the very top
// MUST be sticky — 스크롤해도 항상 상단 고정
// The sticky wrapper MUST carry id="h" AND AppLayout MUST get headerSelector="#h"
// (see "Critical Gotcha: AppLayout headerSelector" below — without it, content scrolls under TopNavigation)
<>
  <div id="h" style={{ position: "sticky", top: 0, zIndex: 1002 }}>
    <TopNavigation
      identity={{ href: "/", title: "My Service" }}
    utilities={[
      { type: "button", iconName: "notification", ariaLabel: "Notifications", badge: true },
      { type: "menu-dropdown", text: "User", items: [
        { id: "profile", text: "Profile" },
        { id: "signout", text: "Sign out" }
      ]}
    ]}
  />
  </div>
  <AppLayout
    headerSelector="#h"  // ← REQUIRED: tells AppLayout the sticky header's height
    navigation={
      <SideNavigation
        activeHref={activeHref}
        header={{ href: "/", text: "My Service" }}
        items={[
          { type: "link", text: "Dashboard", href: "/dashboard" },
          { type: "link", text: "Resources", href: "/resources" },
          { type: "divider" },
          { type: "link", text: "Settings", href: "/settings" },
        ]}
      />
    }
    breadcrumbs={
      <BreadcrumbGroup items={[
        { text: "Home", href: "/" },
        { text: "Resources", href: "/resources" },
        { text: "Resource detail", href: "#" },
      ]} />
    }
    content={/* page content */}
    tools={<HelpPanel header={<h2>Help</h2>}>Help content</HelpPanel>}
  />
</>
```

### Critical Gotcha: AppLayout `headerSelector` (content scrolls under TopNavigation)

**This is the #1 cause of *mis-laid-out* Cloudscape app shells.** Placing a sticky `TopNavigation` above `AppLayout` is necessary but **not sufficient**. `AppLayout` does not know a header sits above it unless you tell it — it locates the header via the `headerSelector` CSS selector (default `'#b #h'`) and offsets its own region + internal scroll container by that element's height.

If the sticky wrapper has no matching id (and you don't pass `headerSelector`), AppLayout assumes header height = 0, claims the full viewport (`top: 0`, `100vh`), and its internal scroll container extends **behind** the TopNavigation. The symptoms:

- The scrollbar runs all the way up into the TopNavigation bar.
- Page content scrolls **under / behind** the sticky TopNavigation instead of stopping below it.

**Fix — two halves that must match:** give the sticky wrapper an id, and pass that same selector to `AppLayout`:

```tsx
// ❌ WRONG — sticky div has no id, AppLayout has no headerSelector
<div style={{ position: "sticky", top: 0, zIndex: 1002 }}>
  <TopNavigation identity={{ href: "/", title: "My Service" }} utilities={utilities} />
</div>
<AppLayout content={children} />          // ← assumes header height 0 → content scrolls under TopNavigation

// ✅ CORRECT — id on the wrapper + matching headerSelector on AppLayout
<div id="h" style={{ position: "sticky", top: 0, zIndex: 1002 }}>
  <TopNavigation identity={{ href: "/", title: "My Service" }} utilities={utilities} />
</div>
<AppLayout headerSelector="#h" content={children} />
```

The selector value is arbitrary as long as both sides agree (`id="h"` ↔ `headerSelector="#h"`). The same applies to a sticky footer: give it an id and pass `footerSelector` (default `'#b #f'`).

### Content Area Patterns

| Page Type | Primary Components | Pattern Reference |
|-----------|-------------------|-------------------|
| Table/List view | `Table`, `Header`, `PropertyFilter`, `Pagination` | `resource-management/view/table-view` |
| Card view | `Cards`, `Header`, `TextFilter` | `resource-management/view/card-view` |
| Detail page | `Container`, `Header`, `KeyValuePairs`, `Tabs` | `resource-management/details/details-page` |
| Create form | `Form`, `FormField`, `Container`, `Header`, `Button` | `resource-management/create/single-page-create` |
| Wizard | `Wizard` | `resource-management/create/multi-page-create` |
| Dashboard | `Board`, `BoardItem`, `Container`, `Header` | `general/service-dashboard/configurable-dashboard` |
| Edit page | `Form`, `FormField`, `Container`, `Button` | `resource-management/edit/page-edit` |
| Split view | `Table`/`Cards` + `SplitPanel` | `resource-management/view/split-view` |
| GenAI chat | `ChatBubble`, `Avatar`, `PromptInput`, `SupportPromptGroup` | `gen-ai/patterns/generative-ai-chat` |
| Agent activity / event timeline | `Steps`, `Header`, `Select` filter, `Divider` | `gen-ai/patterns/timeline-overview` |
| Agent reasoning ("thinking") | `ExpandableSection`, `Steps`, `Link` | `gen-ai/patterns/thinking` |

> GenAI pattern docs live under `https://cloudscape.design/gen-ai/patterns/{slug}/index.html.md` (note the `gen-ai/patterns/` base — the older `patterns/genai/...` URLs 404). See [references/patterns.md](references/patterns.md) for the full GenAI pattern list.

## Component Selection Guide

### "I need to show a collection of items"
- Tabular data with sorting/filtering → `Table` + `useCollection` hook
- Visual cards for browsing → `Cards` + `useCollection` hook
- Simple list → `List`
- Hierarchical data → `TreeView` or `Table` with expandable rows
- Configurable grid layout → `Board` + `BoardItem`

### "I need user input"
- Single line text → `Input`
- Multi-line text → `Textarea`
- Choose one from list → `Select`
- Choose multiple → `Multiselect`
- Search + suggest → `Autosuggest`
- Yes/no toggle → `Toggle` or `Checkbox`
- One of few options → `RadioGroup` or `Tiles`
- Date → `DatePicker`
- Date range → `DateRangePicker`
- File → `FileUpload` or `FileDropzone`
- AI/chat prompt → `PromptInput` (NOT Textarea or Input)

> When any of `Select`, `Multiselect`, `Autosuggest`, `DatePicker`, or `DateRangePicker` sits inside a `Table`, `Modal`, `SplitPanel`, or scrollable container, add `expandToViewport` or the dropdown will be clipped. See [Critical Gotcha](#critical-gotcha-dropdowns-clipped-inside-containers-expandtoviewport).

### "I need to display status/feedback"
- Page-level notifications → `Flashbar`
- Inline warning/info → `Alert`
- Dialog/confirmation → `Modal`
- Tooltip-like info → `Popover`
- Resource status → `StatusIndicator`
- Progress → `ProgressBar` or `LoadingBar`

### "I need navigation"
- Global top bar → `TopNavigation` (outside AppLayout)
- Service sections → `SideNavigation` (inside AppLayout navigation slot)
- Path hierarchy → `BreadcrumbGroup` (inside AppLayout breadcrumbs slot)
- Content sections → `Tabs`
- Multi-step flow → `Wizard` or `Steps`

### "I need a chat/AI interface"
- Chat messages → `ChatBubble` with `Avatar`
- User input → `PromptInput` with action button
- Suggested prompts → `SupportPromptGroup`
- AI loading → `ChatBubble` with `showLoadingBar={true}`
- New message announcements → `LiveRegion`

## Common Implementation Patterns

### Table with useCollection (Recommended Pattern)

Always use `@cloudscape-design/collection-hooks` for Table and Cards. It handles filtering, sorting, pagination, and selection automatically.

```tsx
import Table from "@cloudscape-design/components/table";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import PropertyFilter from "@cloudscape-design/components/property-filter";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useCollection } from "@cloudscape-design/collection-hooks";

const COLUMN_DEFINITIONS = [
  { id: "name", header: "Name", cell: (item) => item.name, sortingField: "name" },
  { id: "status", header: "Status", cell: (item) => (
    <StatusIndicator type={item.status}>{item.statusText}</StatusIndicator>
  ), sortingField: "status" },
  { id: "type", header: "Type", cell: (item) => item.type, sortingField: "type" },
];

const FILTERING_PROPERTIES = [
  { key: "name", propertyLabel: "Name", operators: ["=", "!=", ":", "!:"], groupValuesLabel: "Name values" },
  { key: "status", propertyLabel: "Status", operators: ["=", "!="], groupValuesLabel: "Status values" },
  { key: "type", propertyLabel: "Type", operators: ["=", "!="], groupValuesLabel: "Type values" },
];

function ResourceTable({ items: allItems }) {
  const { items, filteredItemsCount, collectionProps, propertyFilterProps, paginationProps } = useCollection(allItems, {
    propertyFiltering: { filteringProperties: FILTERING_PROPERTIES },
    sorting: { defaultSortingState: { sortingColumn: COLUMN_DEFINITIONS[0], isDescending: false } },
    pagination: { pageSize: 20 },
    selection: {},
  });

  return (
    <Table
      {...collectionProps}
      items={items}
      columnDefinitions={COLUMN_DEFINITIONS}
      header={
        <Header
          counter={`(${filteredItemsCount})`}
          actions={<Button variant="primary">Create resource</Button>}
        >
          Resources
        </Header>
      }
      filter={
        <PropertyFilter
          {...propertyFilterProps}
          countText={`${filteredItemsCount} matches`}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      preferences={
        <CollectionPreferences
          title="Preferences"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          pageSizePreference={{ title: "Page size", options: [
            { value: 10, label: "10 resources" },
            { value: 20, label: "20 resources" },
          ]}}
        />
      }
      stickyHeader
      enableKeyboardNavigation
      selectionType="multi"
      variant="full-page"
    />
  );
}
```

### Generative AI Chat Interface

Use Cloudscape GenAI components — never build a custom chat UI.

```tsx
import ChatBubble from "@cloudscape-design/components/chat-bubble";
import Avatar from "@cloudscape-design/components/avatar";
import PromptInput from "@cloudscape-design/components/prompt-input";
import SupportPromptGroup from "@cloudscape-design/components/support-prompt-group";
import ButtonGroup from "@cloudscape-design/components/button-group";
import LiveRegion from "@cloudscape-design/components/live-region";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Container from "@cloudscape-design/components/container";
import Box from "@cloudscape-design/components/box";

function ChatInterface() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = ({ detail: { value } }) => {
    if (!value.trim()) return;
    setMessages(prev => [...prev, { role: "user", content: value }]);
    setInputValue("");
    setIsLoading(true);
    // Call your AI API, then add assistant message and setIsLoading(false)
  };

  return (
    <SpaceBetween size="l">
      {/* Chat messages area */}
      <div role="region" aria-label="Chat messages">
        <SpaceBetween size="m">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <ChatBubble
                key={i}
                type="outgoing"
                ariaLabel={`You: ${msg.content}`}
                avatar={<Avatar ariaLabel="You" initials="U" />}
              >
                {msg.content}
              </ChatBubble>
            ) : (
              <ChatBubble
                key={i}
                type="incoming"
                ariaLabel={`Assistant: ${msg.content}`}
                avatar={<Avatar ariaLabel="AI Assistant" color="gen-ai" iconName="gen-ai" />}
                actions={
                  <ButtonGroup
                    variant="icon"
                    ariaLabel="Message actions"
                    items={[
                      { type: "icon-button", id: "copy", iconName: "copy", text: "Copy" },
                      { type: "icon-button", id: "thumbs-up", iconName: "thumbs-up", text: "Helpful" },
                      { type: "icon-button", id: "thumbs-down", iconName: "thumbs-down", text: "Not helpful" },
                    ]}
                  />
                }
              >
                {msg.content}
              </ChatBubble>
            )
          )}
          {isLoading && (
            <ChatBubble
              type="incoming"
              ariaLabel="AI is generating a response"
              avatar={<Avatar ariaLabel="AI Assistant" color="gen-ai" iconName="gen-ai" />}
              showLoadingBar
            >
              Generating response...
            </ChatBubble>
          )}
        </SpaceBetween>
      </div>

      {/* Live region for screen reader announcements */}
      <LiveRegion hidden>{messages.length > 0 && messages[messages.length - 1].content}</LiveRegion>

      {/* Suggested prompts (show when no messages yet) */}
      {messages.length === 0 && (
        <SupportPromptGroup
          ariaLabel="Suggested prompts"
          alignment="horizontal"
          items={[
            { id: "1", text: "Summarize this document" },
            { id: "2", text: "Generate a report" },
            { id: "3", text: "Explain this concept" },
          ]}
          onItemClick={({ detail }) => {
            const item = [{ id: "1", text: "Summarize this document" }, { id: "2", text: "Generate a report" }, { id: "3", text: "Explain this concept" }].find(i => i.id === detail.id);
            if (item) setInputValue(item.text);
          }}
        />
      )}

      {/* Prompt input */}
      <PromptInput
        value={inputValue}
        onChange={({ detail }) => setInputValue(detail.value)}
        onAction={handleSend}
        placeholder="Ask me anything..."
        actionButtonAriaLabel="Send"
        actionButtonIconName="send"
        disabled={isLoading}
      />
    </SpaceBetween>
  );
}
```

### Configurable Dashboard

Use `Board` and `BoardItem` for draggable, resizable dashboard layouts — never build custom grid systems.

```tsx
import Board from "@cloudscape-design/components/board";
import BoardItem from "@cloudscape-design/components/board-item";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import LineChart from "@cloudscape-design/components/line-chart";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Box from "@cloudscape-design/components/box";

function Dashboard() {
  const [boardItems, setBoardItems] = useState([
    {
      id: "overview",
      columnSpan: 2, rowSpan: 3,
      data: { title: "Service overview", type: "kv" },
    },
    {
      id: "requests",
      columnSpan: 2, rowSpan: 4,
      data: { title: "Request metrics", type: "chart" },
    },
    {
      id: "alarms",
      columnSpan: 2, rowSpan: 3,
      data: { title: "Active alarms", type: "status" },
    },
  ]);

  return (
    <Board
      items={boardItems}
      onItemsChange={({ detail: { items } }) => setBoardItems(items)}
      renderItem={(item, actions) => (
        <BoardItem
          header={<Header variant="h2">{item.data.title}</Header>}
          settings={
            <ButtonDropdown
              variant="icon"
              ariaLabel="Widget settings"
              items={[
                { id: "configure", text: "Configure" },
                { id: "remove", text: "Remove" },
              ]}
              onItemClick={({ detail }) => {
                if (detail.id === "remove") actions.removeItem();
              }}
            />
          }
          i18nStrings={{
            dragHandleAriaLabel: "Drag handle",
            resizeHandleAriaLabel: "Resize handle",
          }}
        >
          {/* Render content based on widget type */}
          {item.data.type === "kv" && (
            <KeyValuePairs
              columns={2}
              items={[
                { label: "Status", value: <StatusIndicator type="success">Running</StatusIndicator> },
                { label: "Region", value: "us-east-1" },
                { label: "Instances", value: "12" },
                { label: "Uptime", value: "99.9%" },
              ]}
            />
          )}
          {item.data.type === "chart" && (
            <LineChart
              series={[{ title: "Requests", type: "line", data: [/* data points */] }]}
              xDomain={[/* domain */]}
              yDomain={[0, 1000]}
              i18nStrings={{ xTickFormatter: (e) => e.toLocaleDateString() }}
              height={200}
            />
          )}
        </BoardItem>
      )}
      i18nStrings={{
        liveAnnouncementDndStarted: (op) => op === "resize" ? "Resizing" : "Dragging",
        liveAnnouncementDndItemReordered: () => "Item moved",
        liveAnnouncementDndItemResized: () => "Item resized",
        liveAnnouncementDndItemInserted: () => "Item added",
        liveAnnouncementDndCommitted: () => "Changes saved",
        liveAnnouncementDndDiscarded: () => "Changes discarded",
        liveAnnouncementItemRemoved: () => "Item removed",
        navigationAriaLabel: "Dashboard items",
        navigationItemAriaLabel: (item) => item?.data?.title ?? "Dashboard item",
      }}
      empty={<Box textAlign="center" padding="xxl">No dashboard items. Click "Add widget" to get started.</Box>}
    />
  );
}
```

### Create Form

```tsx
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Input from "@cloudscape-design/components/input";

<Form
  actions={
    <SpaceBetween direction="horizontal" size="xs">
      <Button variant="link" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSubmit}>Create</Button>
    </SpaceBetween>
  }
  header={<Header variant="h1">Create resource</Header>}
>
  <Container header={<Header variant="h2">Settings</Header>}>
    <SpaceBetween size="l">
      <FormField label="Name" description="Enter a unique name">
        <Input value={name} onChange={({detail}) => setName(detail.value)} />
      </FormField>
    </SpaceBetween>
  </Container>
</Form>
```

### Delete Confirmation Modal

```tsx
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";

<Modal
  visible={visible}
  onDismiss={onDismiss}
  header="Delete resource"
  footer={
    <Box float="right">
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant="link" onClick={onDismiss}>Cancel</Button>
        <Button variant="primary" onClick={onDelete}>Delete</Button>
      </SpaceBetween>
    </Box>
  }
>
  Permanently delete <b>{resourceName}</b>? This action cannot be undone.
</Modal>
```

## Key Conventions

- Import each component from its own path: `@cloudscape-design/components/{component-name}`
- All events use `({detail}) => ...` pattern (not `(event) => ...`)
- Set `expandToViewport` on `Select`/`Multiselect`/`Autosuggest`/`DatePicker`/`DateRangePicker`/`ButtonDropdown`/`PropertyFilter` whenever they live inside a `Table`, `Modal`, `SplitPanel`, `Cards`, or scrollable `Container` — otherwise the dropdown popover is clipped
- Controlled components: value + onChange for inputs, selectedItems + onSelectionChange for tables
- Use `Header` component for section titles (not raw h1-h6)
- Use `SpaceBetween` for consistent spacing between elements
- **Never type a raw pixel value for spacing** — every gap/padding/margin is a token (`xxxs`–`xxl`) applied via `SpaceBetween`/`Box`/`Grid`/`Container`, never `style={{ padding/margin/gap }}` or a CSS class. See [Spacing & Density](#spacing--density-one-token-scale-no-magic-numbers).
- **Differentiate within-group from between-group spacing**: nest `SpaceBetween` — large token (`l`) between sections/list items, small token (`s`/`xs`) for related lines inside one block. Same gap everywhere = the "messy" look.
- Use `Container` to group related content sections
- Use `Box` for inline styling (padding, margin, color, float) — using spacing tokens, not px values
- Use `variant` props to control visual hierarchy (e.g., Button variant: "primary", "normal", "link")
- Use `StatusIndicator` for status display (types: "success", "error", "warning", "info", "pending", "loading", "stopped")
- Always use `useCollection` hook from `@cloudscape-design/collection-hooks` for Table and Cards — never write manual filtering/sorting/pagination logic
- `TopNavigation` goes OUTSIDE `AppLayout`, not inside it — wrapped in `<div id="h" style={{ position: "sticky", top: 0, zIndex: 1002 }}>` for scroll-fixed behavior. The wrapper id (`#h`) MUST be matched by `AppLayout`'s `headerSelector="#h"`, or content scrolls under the TopNavigation (see [Critical Gotcha: AppLayout headerSelector](#critical-gotcha-applayout-headerselector-content-scrolls-under-topnavigation))
- `SideNavigation` goes in `AppLayout`'s `navigation` slot
- `BreadcrumbGroup` goes in `AppLayout`'s `breadcrumbs` slot

## Accessibility

- Set `enableKeyboardNavigation` on `Table` and `Cards`
- Provide `ariaLabel` props for interactive components
- Use `LiveRegion` for dynamic content announcements (especially in chat UIs)
- Ensure all form fields have labels via `FormField`
- For chat: provide unique `ariaLabel` per `ChatBubble` with author and timestamp context

## References

- **Complete component catalog**: See [references/components.md](references/components.md) for all 100+ components organized by category
- **All patterns**: See [references/patterns.md](references/patterns.md) for all 73 patterns (CRUD, dashboard, GenAI, navigation, etc.)
- **Design foundations**: See [references/foundations.md](references/foundations.md) for colors, typography, spacing, content density, visual modes
- **Design tokens**: See [references/design-tokens.md](references/design-tokens.md) for the `@cloudscape-design/design-tokens` package — real token names (color/typography/spacing/border/shadow/motion), the JS/Sass/CSS-var forms, and when tokens are the right escape hatch. **Required reading before writing any custom CSS.**
- **AI 스트리밍 렌더링**: See [references/ai-streaming.md](references/ai-streaming.md) for SSE 소비 훅(useAIStreaming), Markdown 스트리밍 렌더링(react-markdown), AI 분석/채팅 실시간 갱신 패턴
