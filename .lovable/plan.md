
# Redesign Import OCR/Excel

## Problems identified

1. **Mobile view shows empty cards** - Each imported row renders as a full card with just "Rând 1", "Nr" (empty), "Cantitate" (empty), and an empty "Alege produs..." dropdown. The user can't see the actual product name from the import.
2. **No product name visible** - The imported product denomination (from the Excel) is not displayed prominently in each card. You have to know which column index to select.
3. **Product dropdown is empty** - The Select for "Produs (DB)" only shows suggestions AFTER clicking "Sugerează" per row or "Potrivește produse" globally. Before that, the dropdown is completely empty -- no way to search.
4. **Endless card list** - With hundreds of rows, scrolling through individual cards is unusable.
5. **No status overview** - No way to see at a glance how many rows are matched vs unmatched.

## Plan

### 1. Replace mobile card list with a compact scrollable list

- Show each row as a single compact line: **row number + product name from import + match status icon** (green check / orange warning).
- Tapping a row opens an expandable detail panel (accordion) or a bottom sheet with editing fields and product matching.
- This reduces vertical space from ~200px per card to ~48px per row.

### 2. Show imported product name prominently

- Auto-detect the "denomination" column on import (heuristic: column header containing "denumire", "produs", "material", "articol", or the longest text column).
- Display the value from that column as the primary label in each row, both mobile and desktop.

### 3. Replace empty Select with searchable product picker

- Replace the "Alege produs..." Select (which only shows pre-generated suggestions) with a searchable combo/combobox that queries the DB live as you type.
- Keep the "Sugerează" button to auto-fill the best match, but the user can also manually search anytime.
- Reuse the existing `ProductPicker` dialog component pattern for the search.

### 4. Add summary bar and batch actions

- Show a status bar: "Total: 150 rânduri | Potrivite: 23 | Nepotrivite: 127"
- Add "Potrivește automat toate" button that runs suggestions for all rows AND auto-selects the top match when confidence > 0.85.
- Add "Arată doar nepotrivite" filter toggle.

### 5. Auto-run suggestions on import

- After Excel import completes, automatically run `generateSuggestionsForAllRows()` so users immediately see match candidates without an extra click.

### Technical details

- All changes in `src/pages/ImportOcr.tsx`
- Mobile view (lines 1174-1282): replace card list with accordion-style compact rows
- Product matching: add inline search input with debounced Supabase query (similar to ProductPicker)
- Auto-detect column: add `guessNameColumn(headerCells)` helper
- Status bar: simple computed values from `bodyRows` and `matchedProductIdByRowId`
