---
layout: post
title: "React performance - Measure first, then fix what matters"
date: 2024-09-25
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Javascript', 'Redux']
categories: ['React', 'Javascript']
description: 'React performance - Measure first, then fix what matters'
image: /images/covers/react-performance-measure-then-fix.png
---

Typing in the search box lags: each letter appears a fraction of a second late. Someone adds `useMemo` here, `useCallback` there, wraps three components in `memo`... and it's still slow. In one of my apps I found 42 `useMemo` — and the lag came from somewhere none of them touched. React performance problems are almost always one of a handful of causes, and the cure for each is different. So the first rule is the same as for SQL or C#: **measure, then fix**. Let's see how to find the real cause, and the fixes that matter most, in the order you'll usually need them.

## The core idea: a render cascades down

```sql
<OrdersPage>              ← state changes here (every keystroke in the search box)
  ├─ <SearchBox />        re-renders
  ├─ <Filters />          re-renders (nothing changed for it!)
  ├─ <OrdersTable>        re-renders
  │    └─ 500 × <Row />   re-render  ← the expensive part
  └─ <Charts />           re-renders (heavy, nothing changed)
```

When a component's state changes, React re-renders **it and all its children**, by default — whether their props changed or not. A re-render is usually cheap. It becomes a problem when a **frequent** change (typing, scrolling, a timer) re-renders a **big** subtree.

> **Most React performance work is reducing what re-renders on frequent updates — and rendering less of what's huge.**

---

## Measure: the React DevTools Profiler

Install the **React Developer Tools** browser extension, open the **Profiler** tab, press record, type a few letters, stop.

```sql
Flamegraph (one commit = one render pass):
OrdersPage   2.1 ms
├ SearchBox  0.3 ms
├ Filters    0.4 ms     ← rendered, didn't need to
├ OrdersTable 38 ms     ← 500 rows, on EVERY keystroke
└ Charts     21 ms      ← rendered, didn't need to
```

Enable **"Record why each component rendered while profiling"** in the settings: for each component, the Profiler then says *"Props changed: onSelect"*, *"Parent component rendered"* or *"Hook 2 changed"*. That sentence usually tells you exactly which fix you need.

Also useful:

- **Highlight updates when components render** (DevTools settings): components flash on the screen as they re-render — you *see* the cascade while typing.
- The browser's **Performance** tab for everything that isn't React: long scripts, layout, huge DOM.
- Always measure a **production build** (`npm run build && npm run preview`): development mode (and StrictMode's double rendering) is much slower.

---

## Fix 1: move state down

The most effective fix, and it costs nothing:

```jsx
// ❌ The search text lives at the top: every keystroke re-renders the whole page
function OrdersPage() {
  const [search, setSearch] = useState('');
  return (
    <>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />
      <Filters />
      <OrdersTable search={search} />
      <Charts />
    </>
  );
}
```

`Filters` and `Charts` don't use `search`, yet they re-render on every keystroke. Put the state where it's used:

```jsx
// ✅ Only the search section re-renders while typing
function OrdersPage() {
  return (
    <>
      <OrdersSearchSection />     {/* owns the search state + the table */}
      <Filters />
      <Charts />
    </>
  );
}

function OrdersSearchSection() {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  return (
    <>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />
      <OrdersTable search={debounced} />
    </>
  );
}
```

Two wins: `Filters` and `Charts` no longer re-render, and the table only re-renders when the **debounced** value changes (the hook from the [custom hooks post](/blog/2024/05/22/react-custom-hooks)) — not on every letter.

---

## Fix 2: pass content as children

When a component must hold frequently changing state **and** wrap heavy content, pass the heavy part as `children`:

```jsx
// ❌ ScrollTracker's state changes on every scroll → Dashboard re-renders every time
function ScrollTracker() {
  const [y, setY] = useState(0);
  useEffect(() => { /* window scroll listener → setY */ }, []);
  return <div><ProgressBar value={y} /><Dashboard /></div>;
}

// ✅ Dashboard is created by the PARENT and passed in: it doesn't re-render with ScrollTracker
function ScrollTracker({ children }) {
  const [y, setY] = useState(0);
  useEffect(() => { /* ... */ }, []);
  return <div><ProgressBar value={y} />{children}</div>;
}

<ScrollTracker><Dashboard /></ScrollTracker>
```

`children` is an element created by the parent; when `ScrollTracker` re-renders, that element is the **same object**, so React skips it. No `memo` needed.

---

## Fix 3: memo, useMemo, useCallback — when they help

`memo(Component)` skips re-rendering when **all props are equal** (by reference). It only helps if:

1. the component is **expensive** (a big list, a chart), **and**
2. it receives the **same props** most of the time.

Point 2 is where most `memo`s fail:

```jsx
const OrderRow = memo(function OrderRow({ order, onSelect }) { /* ... */ });

function OrdersTable({ orders }) {
  const [selectedId, setSelectedId] = useState(null);

  // ❌ A new function every render → every memo(OrderRow) re-renders anyway
  // const onSelect = (id) => setSelectedId(id);

  // ✅ The same function every render
  const onSelect = useCallback((id) => setSelectedId(id), []);

  return orders.map((o) => <OrderRow key={o.id} order={o} onSelect={onSelect} />);
}
```

`useCallback` and `useMemo` on their own make nothing faster — they're there to keep props **stable** for a `memo` child, or to avoid a really expensive calculation. Wrapping cheap expressions in `useMemo` (most of my 42) just adds work. The Profiler's "why did this render" tells you if a `memo` is actually skipping renders.

(The React team announced a compiler this year that adds these memoizations automatically. Until it's stable and in your toolchain, the manual rules apply.)

---

## Fix 4: stable values from Redux and RTK Query

`useSelector` re-renders the component when the selected value changes **by reference**:

```jsx
// ❌ A new object on every store update → re-renders on ANY change in the store
const { user, settings } = useSelector((state) => ({ user: state.auth.user, settings: state.ui.settings }));

// ✅ One selector per value (each returns an existing reference)
const user = useSelector((state) => state.auth.user);
const settings = useSelector((state) => state.ui.settings);

// ✅ Derived data: memoized selector (Redux Toolkit re-exports createSelector)
const selectPaidOrders = createSelector([(s) => s.orders.items], (items) => items.filter((o) => o.status === 'paid'));
const paid = useSelector(selectPaidOrders);
```

With RTK Query, subscribe only to what you render with `selectFromResult`:

```jsx
const { order } = useGetOrdersQuery(undefined, {
  selectFromResult: ({ data }) => ({ order: data?.find((o) => o.id === id) }),
});
```

This component now re-renders only when **its** order changes, not when any order in the list does.

---

## Fix 5: long lists → virtualization

Rendering 5,000 rows creates 5,000 × (cells) DOM nodes — slow to create, slow to scroll, heavy in memory, even if React itself is fast. **Virtualization** renders only the rows visible in the viewport (plus a few):

```sql
npm install react-window
```

```jsx
import { FixedSizeList } from 'react-window';

function OrderList({ orders }) {
  return (
    <FixedSizeList height={600} itemCount={orders.length} itemSize={44} width="100%">
      {({ index, style }) => (
        <div style={style} className="order-row">
          #{orders[index].id} — {orders[index].customerName} — {orders[index].total} €
        </div>
      )}
    </FixedSizeList>
  );
}
```

```sql
5,000 orders → ~15 rows in the DOM at any time, recycled while scrolling
```

Data grids like AG Grid virtualize rows (and columns) out of the box — one more reason they handle big tables well (see the [AG Grid post](/blog/2024/07/24/react-ag-grid-server-side-data)).

---

## Fix 6: useTransition and useDeferredValue

Sometimes an update is **heavy and necessary** — filtering a big list as the user types. React 18 lets you mark it as **non-urgent**, so typing stays responsive:

```jsx
function ProductFilter({ products }) {
  const [text, setText] = useState('');
  const deferredText = useDeferredValue(text);         // "lags behind" text when React is busy

  const visible = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(deferredText.toLowerCase())),
    [products, deferredText]
  );

  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />   {/* always instant */}
      <ProductGrid products={visible} dimmed={text !== deferredText} />
    </>
  );
}
```

The input updates immediately (urgent); the filtered grid catches up as soon as React has time, and an in-progress render is **abandoned** if the user types again. `useTransition` does the same for state updates you trigger yourself (`startTransition(() => setTab('reports'))`), with an `isPending` flag for a loading hint.

---

## Fix 7: code splitting

The first load is slow because the browser downloads **all** the app's JavaScript — including the admin pages, the charts library and the PDF viewer most users never open. Split them out:

```jsx
import { lazy, Suspense } from 'react';

const ReportsPage = lazy(() => import('./reports/ReportsPage'));   // its own JS file
const AdminPage = lazy(() => import('./admin/AdminPage'));

<Route
  path="/reports"
  element={
    <Suspense fallback={<p>Loading…</p>}>
      <ReportsPage />
    </Suspense>
  }
/>
```

The reports code (and its charts library) is downloaded only when someone opens `/reports`.

### Check the bundle

```sql
npm install -D rollup-plugin-visualizer
```

Add it to `vite.config.js`, build, and open the generated treemap: you'll usually find one or two surprises — a date library with every locale, an icon pack imported whole (`import * as Icons`), a library pulled in for one function. Import only what you use.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Measure with the Profiler on a production build | Fix the real cause, not a guess |
| Turn on "why did this render" | It names the fix |
| Move frequently changing state down | Fewer components re-render |
| Pass heavy content as `children` | Skips re-renders without `memo` |
| `memo` + stable props (`useCallback`, `useMemo`) for expensive children | `memo` with new props every time does nothing |
| Don't `useMemo` cheap expressions | It adds work, not speed |
| One `useSelector` per value, `createSelector`, `selectFromResult` | Re-render only when your data changes |
| Virtualize long lists | Render what's visible, not 5,000 rows |
| `useDeferredValue` / `useTransition` for heavy updates | Typing stays instant |
| `lazy()` + `Suspense` per route, analyze the bundle | Faster first load |

>
> ## That's it & see you soon!.
>
