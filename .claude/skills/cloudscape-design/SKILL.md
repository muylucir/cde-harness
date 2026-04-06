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

## Installation

```bash
npm install @cloudscape-design/components @cloudscape-design/global-styles @cloudscape-design/collection-hooks
```

Apply global styles at app root:

```tsx
import "@cloudscape-design/global-styles/index.css";
```

## Documentation Access

Fetch live docs from cloudscape.design when you need detailed component APIs or pattern guidance:

- **Component guidelines**: `https://cloudscape.design/components/{name}/index.html.md`
- **Component API (props/events/slots)**: `https://cloudscape.design/components/{name}/index.html.json`
- **Pattern details**: `https://cloudscape.design/patterns/{path}/index.html.md`
- **All components list**: `https://cloudscape.design/components/index.html.md`
- **All patterns list**: `https://cloudscape.design/patterns/index.html.md`
- **Demos with source**: `https://cloudscape.design/demos/index.html.md`
- **Collection hooks guide**: `https://cloudscape.design/get-started/dev-guides/collection-hooks/index.html.md`

Before implementing a complex component, fetch its guidelines and API JSON for accurate props.

## Page Layout Architecture

Every Cloudscape page starts with `AppLayout`:

```tsx
import AppLayout from "@cloudscape-design/components/app-layout";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";

// TopNavigation goes OUTSIDE AppLayout, at the very top
<>
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
  <AppLayout
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
| GenAI chat | `ChatBubble`, `Avatar`, `PromptInput`, `SupportPromptGroup` | `genai/generative-AI-chat` |

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
- Controlled components: value + onChange for inputs, selectedItems + onSelectionChange for tables
- Use `Header` component for section titles (not raw h1-h6)
- Use `SpaceBetween` for consistent spacing between elements
- Use `Container` to group related content sections
- Use `Box` for inline styling (padding, margin, color, float)
- Use `variant` props to control visual hierarchy (e.g., Button variant: "primary", "normal", "link")
- Use `StatusIndicator` for status display (types: "success", "error", "warning", "info", "pending", "loading", "stopped")
- Always use `useCollection` hook from `@cloudscape-design/collection-hooks` for Table and Cards — never write manual filtering/sorting/pagination logic
- `TopNavigation` goes OUTSIDE `AppLayout`, not inside it
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
- **Design foundations**: See [references/foundations.md](references/foundations.md) for colors, typography, spacing, design tokens
- **AI 스트리밍 렌더링**: See [references/ai-streaming.md](references/ai-streaming.md) for SSE 소비 훅(useAIStreaming), Markdown 스트리밍 렌더링(react-markdown), AI 분석/채팅 실시간 갱신 패턴
