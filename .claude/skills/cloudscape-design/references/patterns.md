# Cloudscape Patterns Reference

All 73 patterns. URL: `https://cloudscape.design/patterns/{path}/index.html.md`

Fetch the pattern URL for detailed implementation guidance.

## Resource Management - Create

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Create resource | `resource-management/create` | New resource creation |
| Single page create | `resource-management/create/single-page-create` | Simple-to-medium resource form |
| Multipage create | `resource-management/create/multi-page-create` | Wizard-based complex creation |
| Defaults | `resource-management/create/defaults` | Reduce friction with defaults |

## Resource Management - View

| Pattern | URL Path | Description |
|---------|----------|-------------|
| View resources | `resource-management/view` | Resource discovery and action |
| Table view | `resource-management/view/table-view` | Tabular collection |
| Card view | `resource-management/view/card-view` | Card collection for glancing |
| Split view | `resource-management/view/split-view` | Table/cards + split panel details |
| Table with grouped resources | `resource-management/view/table-with-grouped-resources` | Grouped by characteristics |
| Table with nested resources | `resource-management/view/table-with-nested-resources` | Parent-child expandable rows |

## Resource Management - Details

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Resource details | `resource-management/details` | Display resource info |
| Details page | `resource-management/details/details-page` | Single resource info at a glance |
| Details page as hub | `resource-management/details/details-page-as-hub` | Details + related previews |
| Details page with tabs | `resource-management/details/details-page-with-tabs` | Tab-based config details |

## Resource Management - Edit

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Edit resource | `resource-management/edit` | Modify properties/configurations |
| Attribute editing | `resource-management/edit/attribute-editing` | Create/modify/remove attributes |
| Inline edit | `resource-management/edit/inline-edit` | Quick update across resources |
| Page edit | `resource-management/edit/page-edit` | Bulk property management |

## Resource Management - Delete

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Delete patterns | `resource-management/delete` | Resource deletion |
| Delete with simple confirmation | `resource-management/delete/delete-with-simple-confirmation` | Single confirmation |
| Delete with additional confirmation | `resource-management/delete/delete-with-additional-confirmation` | Multi-step for high-severity |
| One-click delete | `resource-management/delete/one-click-delete` | Quick delete for low-risk |

## General - Navigation & Layout

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Service navigation | `general/service-navigation` | Service structure and global functions |
| Side navigation | `general/service-navigation/side-navigation` | Service section navigation |
| Top navigation | `general/service-navigation/top-navigation` | Global controls and functions |
| Hero header | `general/hero-header` | Showcase key messages/functionality |
| Secondary panels | `general/secondary-panels` | Supportive feature access |
| Help system | `general/help-system` | In-interface help access |

## General - Dashboard

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Service Dashboard | `general/service-dashboard` | At-a-glance service/resource status |
| Configurable dashboard | `general/service-dashboard/configurable-dashboard` | User-customizable dashboard |
| Static dashboard | `general/service-dashboard/static-dashboard` | Predefined dashboard structure |
| Dashboard items | `general/service-dashboard/dashboard-items` | Self-contained dashboard elements |

## General - Actions & Feedback

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Actions | `general/actions` | Invoke actions in interface |
| Global actions | `general/actions/global-actions` | Actions for multiple resources |
| In-context actions | `general/actions/incontext-actions` | Actions tied to singular element |
| Feedback mechanisms | `general/user-feedback` | Communicate messages to user |
| User feedback | `general/collect-user-feedback` | Collect user thoughts |
| Communicating unsaved changes | `general/unsaved-changes` | Warn about discarding changes |

## General - Filtering

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Filtering patterns | `general/filter-patterns` | Find items in collections |
| Saved filter sets | `general/filter-patterns/saved-filter-sets` | Store/reapply filter configs |
| Filter persistence | `general/filter-patterns/filter-persistence-in-collection-views` | Shareable filtered views |

## General - Errors & Validation

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Errors | `general/errors` | Inform of issues/problems |
| Error messages | `general/errors/error-messages` | Context about inaccuracies |
| Validation | `general/errors/validation` | Help with error recovery |

## General - Data & Display

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Data visualization | `general/data-vis` | Graphic data representation |
| Chart metric drill down | `general/data-vis/chart-metric-drill-down` | Hierarchical chart exploration |
| Timestamps | `general/timestamps` | Relative/absolute datetime |
| Empty states | `general/empty-states` | When no resources exist |
| Loading and refreshing | `general/loading-and-refreshing` | Refresh data collections |
| Image magnifier | `general/image-magnifier` | Enlarged image viewing |
| Density settings | `general/density-settings` | Content density preferences |
| Disabled and read-only states | `general/disabled-and-read-only-states` | Non-interactive elements |
| Selection in forms | `general/selection` | Select options from list |
| Drag-and-drop | `general/drag-and-drop` | Select/manipulate UI elements |

## General - Onboarding

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Onboarding | `general/onboarding` | Getting started process |
| Hands-on tutorials | `general/onboarding/hands-on-tutorials` | Contextual workflow guidance |
| Announcing new features | `general/announcing-new-features` | Feature release info |
| Announcing beta/preview | `general/announcing-beta-preview-features` | Feature status communication |

## Generative AI Patterns

| Pattern | URL Path | Description |
|---------|----------|-------------|
| Generative AI chat | `genai/generative-AI-chat` | User-AI conversation interface |
| Conversational history | `genai/history` | Chat history management |
| Pattern abstraction | `genai/genai-patterns` | GenAI pattern framework |
| Ingress | `genai/ingress` | Button to engage AI feature |
| Follow-up questions | `genai/follow-up-questions` | Request additional info |
| Shortcut menus | `genai/shortctut-menus` | Quick access menus |
| Support prompts | `genai/support-prompts` | Suggested prompts for users |
| Progressive steps | `genai/progressive-steps` | Hierarchical task display |
| Artifact previews | `genai/artifact-previews` | Display AI-generated artifacts |
| Response regeneration | `genai/response-regeneration` | Generate alternative response |
| Generative AI loading states | `genai/genai-loading-states` | AI processing status |
| Generative AI output label | `genai/output-label` | Label AI-produced output |
| User authorized actions | `genai/user-authorized-actions` | AI actions needing authorization |
| Variables | `genai/variables` | Variable usage in templates |

## Demos (Source Code)

33 demos available with full source code at: `https://cloudscape.design/demos/index.html.md`
GitHub source: `https://github.com/cloudscape-design/demos/tree/main/src/pages/`

Key demos: `cards`, `chat`, `configurable-dashboard`, `dashboard`, `details`, `details-hub`, `details-tabs`, `edit`, `form-validation`, `wizard`, `table-property-filter`, `server-side-table-property-filter`, `table-editable`, `table-expandable`, `split-panel-multiple`, `top-navigation`
