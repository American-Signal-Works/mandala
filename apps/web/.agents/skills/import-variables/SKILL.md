---
name: import-variables
description: Convert Figma design variables (colors, radius, typography, shadows, spacing) into CSS custom properties and sync them to globals.css. Use when the user pastes a Figma URL, selects a frame in the Figma desktop app, or asks to import design tokens, sync Figma variables, update theme colors, or apply a Figma theme to their project.
allowed-tools: Read, Edit, Bash, mcp__figma__get_variable_defs
---

Convert Figma variables from `$ARGUMENTS` into CSS custom properties.

---

## Step 1 — Determine Figma input

### Option A — Figma URL

If `$ARGUMENTS` contains a Figma URL (`figma.com/design/...`), parse:

- `fileKey`: segment after `/design/`
- `nodeId`: `node-id` query param, converting `-` to `:` (e.g. `25031-105337` → `25031:105337`)

### Option B — Desktop selection

If no URL, use current Figma desktop selection (local MCP at `http://127.0.0.1:3845/mcp`). Set both `fileKey` and `nodeId` to `""`. On failure, ask the user to select a frame or provide a URL.

Auto-detect the CSS file: look for `globals.css` or `app/globals.css` in the project root.

---

## Step 2 — Fetch Figma variables

Call `mcp__figma__get_variable_defs` with parsed `fileKey` and `nodeId`. Returns an object like:

```json
{
  "base/primary": "#d97706",
  "base/background": "#fafafa",
  "text/sm/font-size": "14",
  "border-radius/rounded-lg": "7.2",
  "font/font-sans": "Inter"
}
```

---

## Step 3 — Read the target CSS file

Read the CSS file to:

- Detect the **color format** in use (`oklch(...)`, `hsl(...)`, `rgb(...)`, or hex)
- Identify existing variable names (update existing, add new)

---

## Step 4 — Categorize variables

Group by prefix:

| Figma key pattern                                    | CSS target                       |
| ---------------------------------------------------- | -------------------------------- |
| `base/*`, `color/*`, `colors/*`, `tailwind colors/*` | Color variables (see Step 5)     |
| `border-radius/*`                                    | `--radius` / `--radius-*`        |
| `font/*`                                             | `--font-*`                       |
| `text/*/font-size`                                   | `--text-*` (rem)                 |
| `text/*/line-height`                                 | `--text-*--line-height`          |
| `font-weight/*`                                      | `--font-weight-*`                |
| `shadow/*`, `drop-shadow/*`                          | `--shadow-*` / `--drop-shadow-*` |
| `spacing/*`                                          | `--spacing-*`                    |
| `tracking/*`                                         | `--tracking-*`                   |
| `leading/*`                                          | `--leading-*`                    |

Skip: internal-only tokens, alpha-only tokens, `tailwind colors/base/transparent`, `tailwind colors/base/white` (unless referenced), and non-design tokens.

---

## Step 5 — Map color variables

Strip the `base/` prefix to derive the CSS variable name: `base/primary` → `--primary`, `base/card-foreground` → `--card-foreground`, `base/chart-1` → `--chart-1`, `base/sidebar-accent-foreground` → `--sidebar-accent-foreground`.

This covers all standard shadcn tokens: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive` (each with `-foreground` variant), `border`, `input`, `ring`, `ring-offset`, `chart-1`–`chart-5`, and all `sidebar-*` tokens.

For any `base/*` key not matching a known token, apply the same rule: strip prefix, replace `/` with `-`.

---

## Step 6 — Convert color format

Use the bundled script:

```bash
node apps/web/.agents/skills/import-variables/scripts/convert-colors.js <format> <#rrggbb>
# format: oklch | hsl | hex
```

Match the format detected in Step 3. Preserve any existing alpha patterns (`/ 10%`, `/ 0.5`).

---

## Step 7 — Handle border radius

`border-radius/rounded-lg` maps to `--radius`. Convert px to rem (divide by 16): `7.2` → `0.45rem`.

Only update `--radius` in `:root` — derived tokens (`--radius-sm`, `--radius-md`) compute automatically in `@theme inline`.

---

## Step 8 — Handle fonts

Fonts require coordination between Next.js `next/font` (raw variables) and Tailwind v4 theme tokens.

### 8a. Variable naming

- `next/font` owns **raw** variables: `--font-roboto`, `--font-geist-mono`, `--font-noto-serif`
- `@theme inline` maps **theme tokens** to raw variables: `--font-sans: var(--font-roboto);`

Never set `variable: "--font-sans"` in `next/font` — keep raw and theme names separate.

### 8b. Update `@theme inline`

```css
@theme inline {
  --font-sans: var(--font-dm-sans);
  --font-mono: var(--font-geist-mono);
  /* If Figma provides serif/display: */
  --font-serif: var(--font-noto-serif);
}
```

### 8c. Update `layout.tsx`

Import each font from `next/font/google`, set `variable` to the raw name, and apply all variable classes to `<html>`:

```tsx
import { Roboto, Geist_Mono } from "next/font/google";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// <html className={`${roboto.variable} ${geistMono.variable}`}>
// <body className="font-sans antialiased">
```

Add additional fonts (serif, display) the same way if Figma provides them.

### 8d. Update heading classes

If Figma provides `heading-*/font-family` tokens, update matching CSS classes in `@layer base`:

- `font-family` → `var(--font-serif)` or appropriate token
- `font-size` → px ÷ 16 = rem
- `line-height` → px ÷ 16 = rem (or unitless ratio)
- `letter-spacing` → px ÷ font-size px = em (e.g. `-1.5px / 60px = -0.025em`)

---

## Step 9 — Handle shadows

Map `shadow/*` keys to `--shadow-*` in `:root`. Use modern `rgb()` syntax (not `rgba()`):

```css
--shadow-xs: 0 1px 2px rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
```

Add corresponding entries in `@theme inline` if not already present.

---

## Step 10 — Handle text size / spacing / other tokens

- `text/sm/font-size: 14` → `--text-sm: 0.875rem` (÷ 16)
- `spacing/4: 16` → `--spacing-4: 1rem` (÷ 16)
- Skip tokens that match Tailwind defaults

---

## Step 11 — Dark mode

**If Figma returns separate dark-mode values**: convert and use directly.

**If only light-mode values**: derive dark mode using standard shadcn patterns:

| Role                                 | Dark derivation                                          |
| ------------------------------------ | -------------------------------------------------------- |
| `--background`                       | Darkest value (oklch L ≈ 0.14)                           |
| `--card`, `--popover`                | Slightly lighter (L ≈ 0.21)                              |
| `--secondary`, `--muted`, `--accent` | Dark surface (L ≈ 0.27)                                  |
| `--primary`                          | Lighter/more vibrant variant (L + 0.1, preserve C and H) |
| `--foreground`                       | Lightest value                                           |
| `--border`                           | Same as muted/secondary dark                             |

---

## Step 12 — Update the CSS file

Edit `:root { }` and `.dark { }` blocks with new values. Preserve everything outside those blocks.

For every **new** variable (not already in `@theme inline`), add a corresponding entry:

- Color `--warning` → `--color-warning: var(--warning);`
- Shadow `--shadow-brand` → `--shadow-brand: var(--shadow-brand);`

Standard shadcn tokens already have `--color-*` entries — skip those. Do not duplicate.

---

## Step 13 — Report changes

Output a brief summary:

- Variable categories updated (colors, radius, fonts, shadows, etc.)
- Count of variables changed in `:root` and `.dark`
- Skipped variables and why
- Any manual follow-up needed (e.g. dark mode was derived, not from Figma)
