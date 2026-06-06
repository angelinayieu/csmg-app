---
name: shadcn-primer
description: Component vocabulary primer for shadcn/ui — the canonical 56 primitives, their composition patterns, and the design DNA (Radix + Tailwind + CVA). Use when emitting React in T2 or when shaping HTML/CSS in T0/T1 to match shadcn's restrained, accessible aesthetic.
source: Distilled from https://ui.shadcn.com/r/index.json @ 2026-06-06 (not vendored verbatim — there is no single canonical SKILL.md). See LICENSE.md (MIT) at shadcn-ui/ui.
---

This is a vocabulary primer, not a rules document. The frontend-design skill above sets the floor; the project's DESIGN.md (when present) sets the ceiling. Use this primer to NAME things correctly and to compose primitives in the shadcn idiom.

## Composition DNA

shadcn is not a component library you install — it's source you copy. The DNA is:
- **Headless behavior from Radix UI** primitives (a11y + keyboard nav + portals).
- **Style via Tailwind utility classes** through the `cva()` variant API and the `cn()` className merger (`clsx` + `tailwind-merge`).
- **No themes** — only CSS variables on `:root` (`--background`, `--foreground`, `--primary`, `--border`, `--radius`).
- **Components are functions, not components** — they expose Radix's compound API (`Dialog.Root` → `Dialog.Trigger` → `Dialog.Content`).

When emitting shadcn-flavored React:
- Import paths are `@/components/ui/<kebab-name>`.
- Use `<Button variant="ghost" size="sm">` syntax — do not invent variants. Real variants: `default | secondary | destructive | outline | ghost | link` for Button.
- Use the `cn(...)` helper to merge classNames, not template literals.
- Lean on `<Slot>` (Radix) for `asChild` polymorphism — `<Button asChild><Link href="…">…</Link></Button>`.

When emitting HTML/CSS (T0/T1) in the shadcn idiom:
- `rounded-md` (≈ 6px) and `rounded-lg` (≈ 8px) — never `rounded-xl` on inputs.
- `border` of `--border` (low-contrast, near `hsl(215 14% 90%)`).
- `text-sm font-medium` for buttons; `text-sm` body; `text-xs text-muted-foreground` for meta.
- Focus rings via `ring-2 ring-ring ring-offset-2`.
- Disable raises `opacity-50 pointer-events-none`, not `cursor-not-allowed` alone.

## The 56 primitives (canonical list, by category)

**Action & feedback**
- `button` — primary/secondary/ghost/outline/link/destructive variants × sm/default/lg sizes.
- `button-group` — segmented control.
- `toggle`, `toggle-group` — single/multi pressed states.
- `alert`, `alert-dialog` — passive vs. interrupting confirmation.
- `dialog`, `sheet`, `drawer` — modal, side panel, bottom sheet (mobile-first).
- `tooltip`, `hover-card`, `popover` — tooltip < hovercard < popover by content weight.
- `sonner` — toast (Sonner library wrapped).
- `progress`, `spinner`, `skeleton` — determinate / indeterminate / placeholder.

**Forms & input**
- `input`, `textarea`, `input-otp`, `native-select` — bare inputs.
- `input-group` — input with leading/trailing addons.
- `field` — label + input + description + error wrapper.
- `form` — react-hook-form integration.
- `label`, `checkbox`, `radio-group`, `switch`, `slider` — atomic.
- `select`, `combobox`, `command` — increasing complexity for choice.
- `calendar` — date picker (built on react-day-picker).

**Layout & nav**
- `card` — `<Card>` → `CardHeader` + `CardTitle` + `CardDescription` + `CardContent` + `CardFooter`.
- `separator`, `aspect-ratio`, `scroll-area`, `resizable` — structural.
- `tabs`, `accordion`, `collapsible` — disclosure.
- `breadcrumb`, `pagination`, `navigation-menu`, `menubar`, `sidebar` — navigation.
- `dropdown-menu`, `context-menu` — overflow.

**Data display**
- `table` — `<Table>` → `TableHeader` + `TableBody` + `TableRow` + `TableHead` + `TableCell`.
- `chart` — Recharts wrappers with shadcn theme (`ChartContainer`, `ChartTooltip`, `ChartLegend`).
- `badge` — `default | secondary | destructive | outline`.
- `avatar` — `<Avatar>` → `AvatarImage` + `AvatarFallback`.
- `carousel` — Embla Carousel wrapped.
- `kbd` — keyboard shortcut display (`<kbd>⌘K</kbd>`).
- `empty`, `item` — empty state + list item primitives.

**Meta**
- `direction` — RTL helper.

## Composition examples

A confirmation modal:
```tsx
<Dialog>
  <DialogTrigger asChild><Button variant="destructive">Delete</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete project?</DialogTitle>
      <DialogDescription>This action cannot be undone.</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button variant="destructive" onClick={onConfirm}>Delete</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

A form field with validation:
```tsx
<FormField control={form.control} name="email" render={({ field }) => (
  <FormItem>
    <FormLabel>Email</FormLabel>
    <FormControl><Input type="email" {...field} /></FormControl>
    <FormDescription>We'll only use this for receipts.</FormDescription>
    <FormMessage />
  </FormItem>
)} />
```

A KPI card:
```tsx
<Card>
  <CardHeader>
    <CardDescription>Active users</CardDescription>
    <CardTitle className="text-3xl tabular-nums">12,431</CardTitle>
  </CardHeader>
  <CardContent><Badge variant="secondary">+12.4% WoW</Badge></CardContent>
</Card>
```

## Anti-patterns

- Inventing a variant that doesn't exist (e.g. `<Button variant="primary">` — that's `default`).
- Using `<Modal>` — the primitive is `<Dialog>`.
- Importing from `shadcn/ui` or `@shadcn/ui` — the convention is `@/components/ui/<name>` because the user owns the source.
- Wrapping every Button in a `<div>` for spacing — use `gap-*` on the parent.
- Mixing hex colors with the CSS-variable theme — pick one source of truth per surface.

## Precedence

When the project's DESIGN.md and tailwind.config.ts above call for tokens that DIFFER from shadcn defaults (e.g. our `--radius` is the appleVibe `md: 16px`, not shadcn's `0.5rem`), the project tokens WIN. shadcn is the vocabulary; the project is the dictionary.
