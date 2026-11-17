---
layout: post
title: "Custom React hooks - Extract logic, reuse it, test it"
date: 2024-05-22
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Javascript']
categories: ['React', 'Javascript']
description: 'Custom React hooks - Extract logic, reuse it, test it'
image: /images/covers/react-custom-hooks.png
---

The same fifteen lines appear in eight components: a `useState` for the value, a `useEffect` that reads `localStorage`, another that writes it back, a `try/catch` around `JSON.parse`... and in two of the eight, someone forgot the `try/catch`. When logic repeats like that, or when a component has so many hooks that you can't see what it renders anymore, it's time for a **custom hook**. In the [hooks post](/blog/2024/03/20/react-hooks-explained) we saw the built-in hooks; today we build our own — five useful ones, step by step — and test them.

## The core idea: a custom hook is a function that calls hooks

```js
function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle];
}

// In any component
const [isOpen, toggleOpen] = useToggle();
```

That's all a custom hook is: a JavaScript function whose name starts with **`use`**, which calls other hooks. No magic, no registration. The `use` prefix tells React (and the ESLint rules) to apply the **rules of hooks** inside it.

> **Custom hooks share LOGIC, not STATE. Each component that calls a hook gets its own independent state.**

---

## When to extract — and when not

```sql
✅ The same hook logic appears in 2+ components         (localStorage, debounce, media queries)
✅ A component has many hooks that serve one purpose    (pagination state + derived values)
✅ You want to test the logic without rendering a UI

❌ The logic is used once and is 3 lines long           (a hook adds indirection for nothing)
❌ It doesn't call any hook                              → it's a plain function: name it without "use"
```

The last one is common: `useFormatPrice(amount)` that only calls `Intl.NumberFormat` isn't a hook — it's `formatPrice(amount)`.

---

## Hook 1: useDebounce

A search box that queries the API on every keystroke sends 10 requests for "keyboard". Debounce the **value**: it only changes after the user stops typing.

```js
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);          // a new keystroke cancels the previous timer
  }, [value, delay]);

  return debounced;
}
```

```jsx
function ProductSearch() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 400);
  const { data: products = [] } = useSearchProductsQuery(debouncedQuery, { skip: !debouncedQuery });

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
      <ProductList products={products} />
    </>
  );
}
```

The input stays instant (it uses `query`), the API only sees `debouncedQuery`. One request for "keyboard" instead of eight. The same idea as the `debounce` function from the closures post, but expressed as **state** — which is how React wants it.

---

## Hook 2: useLocalStorage

The fifteen lines from the introduction, written once and safely:

```js
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;                    // private mode, corrupted JSON, storage disabled
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded or storage unavailable: keep working in memory */
    }
  }, [key, value]);

  // Keep other tabs in sync
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === key && e.newValue !== null) {
        try { setValue(JSON.parse(e.newValue)); } catch { /* ignore bad data */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [value, setValue];
}
```

```jsx
const [sidebarOpen, setSidebarOpen] = useLocalStorage('sidebar_open', true);
const [pageSize, setPageSize] = useLocalStorage('orders.pageSize', 25);
```

Details that make it production-ready:

- **`useState(() => ...)`** — the lazy initializer reads storage **once**, not on every render.
- **`try/catch` everywhere** — `localStorage` can throw (private browsing, quota, disabled cookies), and stored JSON can be corrupted by an older version of the app.
- **The `storage` event** — fires in *other* tabs when one tab changes the value, so all tabs stay consistent.

Use it for preferences (sidebar, page size, sort order) — never for tokens, as we saw in the [authentication post](/blog/2024/02/21/react-authentication-jwt-refresh-rtk-query).

---

## Hook 3: useMediaQuery

Many UI kits generate a `useIsMobile` hook; here's the general version, built on `useSyncExternalStore` (React 18) — the right tool to subscribe to something outside React:

```js
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query]
  );

  const getSnapshot = () => window.matchMedia(query).matches;

  return useSyncExternalStore(subscribe, getSnapshot);
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
```

```jsx
const isMobile = useIsMobile();
return isMobile ? <OrderCards orders={orders} /> : <OrderTable orders={orders} />;
```

`useSyncExternalStore` handles the subscription, cleanup and "the value changed between render and subscribe" edge cases that a hand-written `useState` + `useEffect` version gets subtly wrong.

---

## Hook 4: usePagination — pure logic, no effects

Not every hook needs an effect. This one just organizes state and derived values:

```js
export function usePagination({ totalItems, pageSize = 25, initialPage = 1 }) {
  const [page, setPage] = useState(initialPage);
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(page, pageCount);            // stay valid if totalItems shrinks

  return {
    page: current,
    pageCount,
    offset: (current - 1) * pageSize,
    hasPrevious: current > 1,
    hasNext: current < pageCount,
    next: () => setPage((p) => Math.min(p + 1, pageCount)),
    previous: () => setPage((p) => Math.max(p - 1, 1)),
    goTo: (n) => setPage(Math.min(Math.max(1, n), pageCount)),
  };
}
```

```jsx
const pager = usePagination({ totalItems: data.total, pageSize: 25 });
const { data } = useGetOrdersQuery({ offset: pager.offset, limit: 25 });

<button onClick={pager.previous} disabled={!pager.hasPrevious}>Previous</button>
<span>Page {pager.page} / {pager.pageCount}</span>
<button onClick={pager.next} disabled={!pager.hasNext}>Next</button>
```

Notice `current` is **computed**, not synced with an effect — the "derived state" rule from the hooks post. The component that used to hold six variables and four functions now holds one `pager`.

---

## Hook 5: useInterval — fixing the stale closure

The interval that keeps reading `0` (from the closures post) is a classic. A hook fixes it once for all:

```js
export function useInterval(callback, delay) {
  const savedCallback = useRef(callback);

  // Always keep the latest callback, without restarting the interval
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;                        // null = paused
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
```

```jsx
function LiveDashboard() {
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);

  useInterval(() => setSeconds(seconds + 1), paused ? null : 1000);   // reads the CURRENT seconds

  return <button onClick={() => setPaused((p) => !p)}>{seconds}s {paused ? '▶' : '⏸'}</button>;
}
```

The interval is created once per `delay`; the **ref** always points to the newest callback, so it never sees stale values.

---

## Naming, return values, stable callbacks

| Choice | Guideline |
|---|---|
| Name | Always `useSomething` — required for the lint rules to check it |
| Return 1 value | Return it directly: `const isMobile = useIsMobile()` |
| Return 2 values | An array, so callers name them: `const [value, setValue] = useLocalStorage(...)` |
| Return 3+ values | An object: `const pager = usePagination(...)` — named, order doesn't matter |
| Returned functions | Wrap in `useCallback` when callers may pass them to `memo` children or effect deps |
| Options | One options object (`{ totalItems, pageSize }`) instead of many positional parameters |

---

## Hooks share logic, not state

```jsx
function Header()  { const [open, setOpen] = useLocalStorage('sidebar_open', true); ... }
function Sidebar() { const [open] = useLocalStorage('sidebar_open', true); ... }
```

Two components, two **separate** `useState`s inside the hook. If `Header` toggles, `Sidebar` doesn't re-render (localStorage changed, but its state didn't). Custom hooks are not a global store. When several components must share **live** state, lift it to a common parent, put it in a Context, or in Redux — and use the hook *there*.

---

## Testing hooks

Hooks can't be called outside a component — `renderHook` from Testing Library renders a tiny one for you:

```js
import { renderHook, act } from '@testing-library/react';

test('usePagination moves between pages and stays in range', () => {
  const { result } = renderHook(() => usePagination({ totalItems: 60, pageSize: 25 }));

  expect(result.current.pageCount).toBe(3);
  expect(result.current.hasPrevious).toBe(false);

  act(() => result.current.next());
  act(() => result.current.next());
  act(() => result.current.next());          // already on the last page

  expect(result.current.page).toBe(3);
  expect(result.current.offset).toBe(50);
});

test('useDebounce updates only after the delay', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
    initialProps: { value: 'a' },
  });

  rerender({ value: 'ab' });
  expect(result.current).toBe('a');           // not yet

  act(() => jest.advanceTimersByTime(300));
  expect(result.current).toBe('ab');
});
```

`act(...)` wraps state updates so React finishes processing them before you assert. Testing the hook directly is much faster and more precise than testing every component that uses it.

---

## Key rules to remember

| Rule | Why |
|---|---|
| A custom hook = a `use...` function that calls hooks | Nothing more, nothing less |
| Extract repeated or noisy hook logic | One fix instead of eight |
| No hooks inside? It's a plain function — drop the `use` | Honest naming |
| Hooks share logic, not state | Each caller gets its own state |
| Lazy `useState(() => ...)` for expensive initial values | Runs once, not every render |
| `try/catch` around `localStorage` and `JSON.parse` | Storage can throw, data can be corrupted |
| `useSyncExternalStore` to subscribe to browser APIs | Correct subscriptions and cleanup |
| Compute derived values, don't sync them with effects | Pagination stays valid without effects |
| `useRef` for the latest callback in timers and subscriptions | No stale closures, no restarts |
| Array for 2 values, object for 3+ | Readable call sites |
| Test hooks with `renderHook` + `act` | Fast, focused tests |

>
> ## That's it & see you soon!.
>
