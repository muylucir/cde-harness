# Cloudscape Components Reference

All 101 components. Guidelines: `https://cloudscape.design/components/{name}/index.html.md`
API (JSON): `https://cloudscape.design/components/{name}/index.html.json`

Fetch the guidelines URL for usage guidance, the JSON URL for props/events/slots API details.

## Layout & Structure

| Component | Description |
|-----------|-------------|
| `app-layout` | Page structure with collapsible side navigation, tools panel, drawers, split panel |
| `app-layout-toolbar` | Page structure with navigation and panels in toolbar form |
| `content-layout` | Page structure for expressive/hero use cases |
| `column-layout` | Position content in responsive columns |
| `grid` | Distribute content on a page for consistent responsive layouts |
| `container` | Group related content pieces together |
| `space-between` | Helper adding consistent spacing between elements |
| `box` | Display/style basic elements per Cloudscape typography and spacing |
| `panel-layout` | Display two content panels side by side |

## Navigation

| Component | Description |
|-----------|-------------|
| `top-navigation` | Global persistent navigation across pages (place OUTSIDE AppLayout) |
| `side-navigation` | Structural view of service navigation (place in AppLayout navigation slot) |
| `breadcrumb-group` | Hierarchical navigational links (place in AppLayout breadcrumbs slot) |
| `anchor-navigation` | Quick-jump via anchor links to page content |
| `tabs` | Switch between information categories in same view |
| `wizard` | Multi-page form guiding complex flows |
| `steps` | Display a task list |
| `pagination` | Horizontal navigation between collection pages |
| `link` | Anchor tag for hyperlinks |

## Data Display

| Component | Description |
|-----------|-------------|
| `table` | Two-dimensional data: sorting, selection, expandable rows, inline editing. Always use with `useCollection` hook |
| `cards` | Collection of resources as cards. Always use with `useCollection` hook |
| `key-value-pairs` | Properties followed by corresponding values |
| `badge` | Small visual element for labels/categories |
| `status-indicator` | Resource state in compact form (types: success, error, warning, info, pending, loading, stopped) |
| `tag-editor` | Create, edit, delete resource tags |
| `token` | Compact representation of items |
| `token-group` | Multiple compact item representations |
| `tree-view` | Hierarchical list of nested items |
| `list` | Group of consecutive items |

## Forms & Input

| Component | Description |
|-----------|-------------|
| `form` | Interactive controls for submitting information |
| `form-field` | Properly-styled form controls |
| `input` | Single line text input |
| `textarea` | Multi-line plain-text input |
| `select` | Choose single item from list |
| `multiselect` | Choose multiple items from list |
| `autosuggest` | Choose from suggestion list |
| `checkbox` | Turn option on/off |
| `radio-group` | Choose one from predefined set |
| `toggle` | Turn option on/off with immediate change |
| `toggle-button` | Toggle between two actions/states |
| `slider` | Select value within defined range |
| `date-picker` | Enter/choose date values |
| `date-input` | Date entry form element |
| `date-range-picker` | Date and time range specification |
| `time-input` | Absolute time value entry |
| `calendar` | Date selection via calendar |
| `tiles` | Predefined options with comparison metadata |
| `segmented-control` | Toggle between content formatting methods |
| `attribute-editor` | Create, edit, delete attributes |
| `property-filter` | Find items using properties, values, operators |
| `text-filter` | Text entry for matching collection items |
| `collection-preferences` | Manage display preferences within collections |
| `collection-select-filter` | Filter with select-style UI |

## File Handling

| Component | Description |
|-----------|-------------|
| `file-upload` | Select and upload local files |
| `file-input` | File selection trigger |
| `file-dropzone` | Drag-and-drop file upload area |
| `file-token-group` | Uploaded files displayed as tokens |

## Feedback & Status

| Component | Description |
|-----------|-------------|
| `alert` | Brief informational/action message |
| `flashbar` | Page-level flash notifications |
| `modal` | Subordinate window blocking main content |
| `popover` | On-demand contextual information (use instead of custom tooltips) |
| `spinner` | Compact looping animation for running processes |
| `progress-bar` | Operation progress with known duration |
| `loading-bar` | Linear indicator for unknown duration operations |
| `error-boundary` | Isolate unexpected application errors |
| `live-region` | Non-visual announcements for assistive technology |

## Actions

| Component | Description |
|-----------|-------------|
| `button` | Initiate actions in UI (variants: primary, normal, link, icon, inline-icon, inline-link) |
| `button-dropdown` | Group multiple actions under single button |
| `button-group` | Actions via grouped buttons (great for inline actions in chat/tables) |
| `copy-to-clipboard` | Copy content to clipboard |

## Content & Typography

| Component | Description |
|-----------|-------------|
| `header` | Summarize content with action button space (use instead of raw h1-h6) |
| `text-content` | Apply default typographical styles |
| `icon` | Display basic icons (120+ built-in icons) |
| `expandable-section` | Expand/collapse section content |
| `code-editor` | Write and edit code |
| `code-view` | Read-only code snippet with copy (use instead of custom code blocks) |

## Charts & Visualization

| Component | Description |
|-----------|-------------|
| `line-chart` | Visualize data emphasis on change over time |
| `bar-chart` | Visualize emphasis on total amount per data point |
| `area-chart` | Visualize two+ series with part-to-whole emphasis |
| `pie-chart` | Visualize metric relationships and correlations (donut variant available) |
| `mixed-line-bar-chart` | Related data series on single chart |

## Panels & Drawers

| Component | Description |
|-----------|-------------|
| `split-panel` | Collapsible panel for secondary info/controls |
| `drawer` | Supplementary content panel with icon triggers |
| `help-panel` | Help content for page concepts/tasks |
| `tutorial-panel` | Contextual hands-on tutorials |

## GenAI Components

| Component | Description |
|-----------|-------------|
| `chat-bubble` | Visual representation of chat messages — type "incoming" (AI) or "outgoing" (user), with avatar, actions, loading bar |
| `avatar` | Visual representation of user or AI entity — use color="gen-ai" and iconName="gen-ai" for AI avatars |
| `prompt-input` | Prompt/command input field with action button, secondary actions/content slots. Use for AI chat input, NOT textarea |
| `support-prompt-group` | Selectable message prompts for AI chats — horizontal or vertical alignment |

## Specialized

| Component | Description |
|-----------|-------------|
| `s3-resource-selector` | Read/write to S3 buckets with prefix support |
| `board` | Configurable dashboard layout with drag-and-drop, 12-column responsive grid |
| `board-item` | Self-contained UI element within board with drag/resize handles |
| `items-palette` | Add board items via split panel |
| `annotation-context` | Tutorial progress tracking with popovers |
| `hotspot` | Annotation popover/icon placement |
