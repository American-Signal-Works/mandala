---
name: generate-code
description: Generate a responsive React component from a Figma design. Use when the user pastes a Figma URL, selects a frame in the Figma desktop app, or asks to convert a Figma design to code. Converts Figma frames built with the shadcn/ui Kit for Figma (shadcndesign.com) into production-ready TSX using the project's existing shadcn/ui components, Tailwind CSS, and proper icon imports. Also use when the user mentions "Figma to code," "generate component," "convert design," or references a figma.com URL.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep, Skill, AskUserQuestion, mcp__figma__get_design_context, mcp__figma__get_screenshot, mcp__figma__get_metadata, mcp__shadcn__search_items_in_registries, mcp__shadcn__view_items_in_registries, mcp__shadcn__get_item_examples_from_registries, mcp__shadcn__get_add_command_for_items, mcp__shadcn__get_project_registries, mcp__shadcn__get_audit_checklist
---

Generate a production-ready React component from a Figma design created with the **shadcn/ui Kit for Figma** (shadcndesign.com).

---

## Step 1 — Determine Figma input

### Option A — Figma URL

If `$ARGUMENTS` contains a Figma URL (`figma.com/design/...`), parse:

- `fileKey`: segment after `/design/`
- `nodeId`: `node-id` query param, converting `-` to `:` (e.g. `23022-103799` → `23022:103799`)
- Branch URLs (`/design/:fileKey/branch/:branchKey/...`): use `branchKey` as `fileKey`

### Option B — Desktop selection

If no URL provided, use current Figma desktop selection (requires local MCP at `http://127.0.0.1:3845/mcp`). Set both `fileKey` and `nodeId` to `""`. On failure, tell the user to select a frame or provide a URL.

---

## Step 2 — Fetch design context

### 2a. Scan structure first

Full pages exceed the 25,000 token output limit and get silently truncated. **Always start with `get_metadata`** to inspect the node tree.

### 2b. Single vs. chunked fetch

- **Single section** (1 block or simple component): one `get_design_context` call on the original `nodeId`.
- **Multi-section page** (2+ direct child frames, or children matching `Pro Blocks / ...`): fetch each child individually. Use `get_screenshot` on the full page node for overall visual context.

### 2c. What design context returns

Each call returns reference code (React + Tailwind), a screenshot, component descriptions, design tokens, and asset URLs (7-day expiry). Set `clientFrameworks` and `clientLanguages` from `package.json`/`tsconfig.json`.

The returned code uses raw CSS variables and inline Figma styles — treat it as a **structural reference only**, never copy verbatim.

### 2d. Truncation recovery

If a response contains `[OUTPUT TRUNCATED`, re-fetch child sections individually via `get_metadata` → per-child `get_design_context`.

---

## Step 3 — Detect Pro Blocks

Check the root element's `data-name`. If it matches `Pro Blocks / <Category> / <Number>.`, the design uses a Pro Block from `@shadcndesign`. Examples: `Pro Blocks / Hero Section / 5.`, `Pro Blocks / Sign Up / 1.`.

- **No Pro Block detected** → skip to Step 4 (build from scratch).
- **Pro Block detected** → follow Steps 3a–3e below, then jump to Steps 7–8, then Step 10.

### 3a. Parse registry item name

1. Strip `Pro Blocks / ` prefix
2. Take category, convert to kebab-case (e.g. `Hero Section` → `hero-section`)
3. Take number, strip trailing dot (e.g. `5.` → `5`)
4. Combine: `@shadcndesign/<category>-<number>` (e.g. `@shadcndesign/hero-section-5`)

Verify with `mcp__shadcn__search_items_in_registries`. If not found, fall back to Step 4.

### 3b. Install or locate base block

Check `components/pro-blocks/**/<block-name>.tsx` via Glob.

- **Exists**: read it as the base template.
- **Missing**: get install command via `mcp__shadcn__get_add_command_for_items`, run it, then read the installed file.

**Never edit the base block directly** — the same block can be reused across pages.

### 3c. Create a working copy

Derive a meaningful name from the Figma context:

- If root node is a custom frame (e.g. `data-name="Wine Landing"`): `<frame-name>-<block-name>.tsx`
- If root IS the Pro Block: derive from content (heading, brand). If unclear, ask the user.

Place the copy in the same category directory as the base. Update the exported function name to PascalCase.

### 3d. Edit the copy to match Figma

**Do a systematic element-by-element diff** of the Figma reference code + screenshot against the base block. Walk through every element in the Figma output and find its counterpart in the base block. For each element, check for differences in:

- **Text content**: headings, descriptions, labels, placeholders, button text
- **Structure**: added/removed elements, reordered children, changed nesting
- **Components**: swapped components, changed variants/props, added/removed children
- **Layout**: flex direction, grid columns, alignment, gap, padding, width constraints. Pay attention to section-level padding (e.g. `section-padding-y`) present in the Figma root node — don't drop it when creating the copy
- **Backgrounds**: translate Figma arbitrary-value bg classes, inline `style` backgrounds, and gradients to semantic tokens. White-over-color blends (e.g. 90% white over primary) → `bg-primary/10`, not `bg-muted`
- **Colors, typography, borders, shadows, spacing**: any visual property that differs

If any element differs, update the copy. When a background changes, cascade color updates to all children for contrast using `<background>-foreground` tokens.

The Figma screenshot is the ultimate source of truth — if something looks different, it IS different.

### 3e. What NOT to change

- Don't rewrite the component from scratch — make targeted edits only if you detect differences in layout or components in the block
- Don't modify the base block file
- Preserve existing code style and responsive behavior

After edits, proceed to Steps 7–8, then Step 10.

---

## Step 4 — Inventory local components

1. Read `components.json` for shadcn/ui config (style, aliases, icon library, registries)
2. List `components/ui/**/*.tsx` and `components/**/*.tsx` via Glob
3. Read `app/globals.css` for theme tokens

### Install missing components

If a Figma component maps to a shadcn/ui component not in the project:

1. `mcp__shadcn__search_items_in_registries` with the component name
2. `mcp__shadcn__get_add_command_for_items` for the install command
3. Run via Bash, then read the installed file before using it

---

## Step 5 — Map Figma components to local components

> Skip if Pro Block detected.

Match Figma component names to local `@/components/ui/*` imports. Common mappings:

- `Button`, `Input`/`InputGroup`, `Field`, `Checkbox`, `Separator`, `Avatar`, `Badge`, `Card`, `Dialog`, `Select`, `Tabs`, `Table`, `Sheet`, `DropdownMenu`, `Tooltip`, `Label`, `Textarea`, `Switch`, `RadioGroup`, `Slider`, `Progress`, `Accordion`, `Alert`, `Breadcrumb`, `Pagination`, `Popover`, `NavigationMenu`, `Sidebar`
- `Typography / H1`, `Typography / H2`, etc. → native HTML elements with Tailwind classes
- `Pro Blocks / *` → check `components/pro-blocks/`

**Read each component's source file** before using it — understand exports, props, variants, and composition patterns.

---

## Step 6 — Detect style differences

Compare Figma design tokens with local component styles (sizes, padding, radius, typography, colors). If differences exist, ask the user:

1. **Apply inline (Recommended)** — override via `className`
2. **Update component file** — edit `/components/ui/` source

Default to inline styling.

---

## Step 7 — Handle icons

### 7a. Identify the project's icon library

Check `iconLibrary` in `components.json` (e.g. `"lucide"` → `lucide-react`).

### 7b. Identify the Figma design's icon library

Figma layer names reveal the source library (e.g. `Tabler Icon / cheese`, `Lucide Icon / ArrowRight`, `Phosphor / House`). The Figma icon library may differ from the project's.

### 7c. Map icons to the project library

Extract icon names from Figma layers, convert to PascalCase. For each icon:

1. **Same library** (Figma and project match): import directly.
2. **Different library** (e.g. Figma uses Tabler, project uses Lucide): find the equivalent icon in the project's library by name. Many icons share names across libraries.

Replace all `<img src={imgVector...} />` with proper icon components — never use Figma asset URLs.

### 7d. Verify icons exist

**Verify every icon import exists** in the project's icon library (e.g. `node -e "console.log(!!require('lucide-react').IconName)"`). If an icon doesn't exist:

1. **Check if the Figma source library's npm package is installed** (e.g. `@tabler/icons-react`, `@phosphor-icons/react`). If not, install it.
2. **Import the icon from the Figma source library** directly.
3. **Last resort** — if no suitable package exists, create an inline SVG component in the same file using the icon's SVG paths, matching the project library's convention (`className` prop, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth={2}`).

For Pro Block flow: only change icons that differ between Figma and the template.

---

## Step 8 — Handle images and logos

Figma returns temporary asset URLs (7-day expiry) for images, logos, and illustrations. Never use these in final code.

### 8a. Identify assets

Look for `<img>` tags with Figma CDN URLs, asset variables (`imgLogo`, `imgHero`), and background `url()` references. Distinguish standard icons (Step 7) from brand assets.

### 8b. Ask the user

1. **Download to public/ (Recommended)** — download and use with `next/image`
2. **Placeholder paths** — insert paths like `/placeholder-logo.svg`
3. **Skip images** — use `<div>` placeholders

### 8c. Download and reference

Download to `public/images/` with kebab-case names. Use `next/image` with `width`, `height`, and `alt` props. For avatars in sample designs, prefer `AvatarFallback` with initials.

For Pro Block flow: replace existing placeholder paths in the copy with downloaded asset paths.

---

## Step 9 — Build from scratch

> Skip if Pro Block detected.

### Structure

```tsx
// 1. Imports (React, components, icons, utils)
// 2. Types/interfaces
// 3. Constants for repeating data
// 4. Helper/sub-components (same file)
// 5. Main component (default export)
```

### Rules

- Import shadcn/ui from `@/components/ui/*`, icons from project's library, `cn` from `@/lib/utils`
- Use Tailwind utility classes only — no inline styles, no hardcoded hex colors, only semantic tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, etc.)
- When sections have non-default backgrounds, adapt all child element colors for contrast
- Use responsive prefixes (`sm:`, `md:`, `lg:`) — stack on mobile, expand on desktop
- Extract repeating data into typed constants, render with `.map()`
- Define a `Props` interface with `className?: string`
- Use `gap-*` over margins, `flex`/`grid` over absolute positioning

### Do NOT include

- Figma asset URLs or `data-node-id` attributes
- Raw CSS `var()` syntax
- Placeholder comments or unused imports

---

## Step 10 — Verify

Run through this checklist:

1. All imports resolve to existing files
2. No Figma asset URLs, `data-node-id` attributes, or raw CSS `var()` remain
3. No hardcoded colors — only semantic Tailwind tokens
4. Component is responsive (mobile, tablet, desktop)
5. Icons use proper component imports
6. Forms use semantic HTML (`<form>`, `<label>`, `<input>`)
7. TypeScript types are correct
8. **(Pro Block)** Base block unmodified; copy has unique name and matching export
9. **(Pro Block)** Element-by-element: every difference between Figma reference and base block is reflected in the copy — text, structure, components, layout, backgrounds, colors, spacing
10. **(Both)** Every visual detail matches the Figma screenshot — if it looks different, it IS different

Call `mcp__shadcn__get_audit_checklist` for additional project-specific checks.
