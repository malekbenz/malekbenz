---
layout: post
title: "React hooks explained - useState, useEffect, useRef, useMemo, useCallback (and when not to use them)"
date: 2024-03-20
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Javascript']
categories: ['React', 'Javascript']
description: 'React hooks explained - useState, useEffect, useRef, useMemo, useCallback, and when not to use them'
image: /images/covers/react-hooks-explained.png
---

I recently counted the hooks in one of my React apps: **44** `useEffect`, **42** `useMemo`. Some were necessary. Many were not: effects that copy a prop into a state, an effect that sets a state that triggers another effect, a `useMemo` around a string concatenation. The app worked, but it rendered twice when once was enough, and some bugs only appeared when you clicked fast. Hooks are simple once you understand **one** idea. Let's start from that idea, go through each hook with a simple example, and then look at the most common case of all: when **not** to use `useEffect`.

## The core idea: a component is a function that runs on every render

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  console.log('render', count);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

```sql
First render   → Counter() runs → count = 0 → shows "0"
Click          → setCount(1)    → React calls Counter() AGAIN → count = 1 → shows "1"
Click          → setCount(2)    → Counter() runs again ...
```

Every render is a **new call** of your function. Local variables are recreated each time. Hooks are how a component **remembers** things between those calls:

| Hook | Remembers | Changing it re-renders? |
|---|---|---|
| `useState` | A value shown on screen | ✅ Yes |
| `useRef` | A value NOT shown on screen (timer id, DOM node, previous value) | ❌ No |
| `useMemo` | A computed value, until its inputs change | — |
| `useCallback` | A function, until its inputs change | — |
| `useEffect` | Code to run **after** render, to sync with the outside world | — |

> **If you remember one thing: rendering must be a pure calculation. Everything else — network, timers, subscriptions, DOM — goes in event handlers or effects.**

---

## useState

```jsx
const [query, setQuery] = useState('');
const [filters, setFilters] = useState({ status: 'all', city: null });
```

### Updates are not immediate

```jsx
function handleClick() {
  setCount(count + 1);
  setCount(count + 1);
  console.log(count);      // still the OLD value — the new one arrives on the next render
}
// Result: +1, not +2 — both calls used the same "count" of this render
```

When the new value depends on the previous one, use the **function form**:

```jsx
setCount((c) => c + 1);
setCount((c) => c + 1);    // +2 ✅
```

### Objects and arrays: replace, don't mutate

```jsx
// ❌ Same object → React sees no change → no re-render
filters.status = 'paid';
setFilters(filters);

// ✅ A new object
setFilters((f) => ({ ...f, status: 'paid' }));
```

### Keep the minimum state

If a value can be **computed** from props or other state, it's not state. We'll come back to this — it's the root of most useless effects.

---

## useEffect: sync with the outside world

An effect runs **after** React has updated the screen. Its job: connect your component to something **outside React**.

```jsx
useEffect(() => {
  const id = setInterval(() => setNow(new Date()), 1000);   // setup
  return () => clearInterval(id);                            // cleanup
}, []);                                                       // dependencies
```

### Dependencies

| Dependencies | The effect runs |
|---|---|
| `[]` | After the first render (and cleanup when the component leaves) |
| `[orderId]` | After the first render, and again each time `orderId` changes |
| no array | After **every** render — almost never what you want |

Before running again, React calls the **cleanup** of the previous run. That's how you avoid duplicated subscriptions:

```jsx
useEffect(() => {
  const connection = createChatConnection(roomId);
  connection.connect();
  return () => connection.disconnect();    // leave the old room before joining the new one
}, [roomId]);
```

Always list **every** value from the component that the effect uses. The ESLint rule `react-hooks/exhaustive-deps` checks it — keep it on, and don't silence it with `// eslint-disable`: a missing dependency means the effect uses a **stale** value.

### Why does my effect run twice?

In development, React 18 **StrictMode** mounts every component, unmounts it, and mounts it again. Effects run twice on purpose: if your app breaks, your cleanup is missing or wrong. In production it runs once. Don't "fix" it by removing StrictMode — fix the cleanup.

---

## When NOT to use useEffect

This is where most of my 44 effects went wrong. The React docs have a whole page about it ("You Might Not Need an Effect"). The four cases I see the most:

### 1. Derived state: compute it during render

```jsx
// ❌ Two renders, and a moment where fullName is out of date
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);

// ✅ Just compute it
const fullName = `${firstName} ${lastName}`;
```

Same for a filtered list:

```jsx
// ❌
const [visibleOrders, setVisibleOrders] = useState([]);
useEffect(() => {
  setVisibleOrders(orders.filter((o) => o.status === status));
}, [orders, status]);

// ✅ (add useMemo only if the list is really big — see below)
const visibleOrders = orders.filter((o) => o.status === status);
```

The rule: **if you can compute it from props or state, don't store it.**

### 2. Copying props into state

```jsx
// ❌ The classic: "init my form state from the props"
function OrderForm({ order }) {
  const [form, setForm] = useState(order);
  useEffect(() => {
    setForm(order);              // runs AFTER a render with the old form → flicker, lost edits
  }, [order]);
  // ...
}
```

If the goal is "reset the form when we show another order", give the component a **key**: React throws away the old instance and creates a fresh one.

```jsx
// ✅ In the parent
<OrderForm key={order.id} order={order} />

// ✅ In the child: useState(order) is only the INITIAL value
function OrderForm({ order }) {
  const [form, setForm] = useState(order);
  // ...
}
```

### 3. Reacting to an event: put it in the handler

```jsx
// ❌ "When submitted becomes true, send the request"
const [submitted, setSubmitted] = useState(false);
useEffect(() => {
  if (submitted) {
    saveOrder(form);
    showToast('Saved!');
  }
}, [submitted]);

// ✅ The user clicked — that's an event, handle it in the event
async function handleSubmit() {
  await saveOrder(form);
  showToast('Saved!');
}
```

Ask yourself: **why** does this code run? "Because the user did something" → event handler. "Because the component is on screen" → effect.

### 4. Fetching data

```jsx
// ❌ Works... until you handle loading, errors, race conditions, caching, refetching
useEffect(() => {
  setLoading(true);
  fetch(`/api/orders?status=${status}`)
    .then((r) => r.json())
    .then((data) => { setOrders(data); setLoading(false); });
}, [status]);
```

The hidden bug: the user switches from "paid" to "new" quickly; the "paid" response arrives **last** and overwrites the "new" list. You need an `ignore` flag in the cleanup, plus loading and error states, plus a cache...

```jsx
// ✅ Let a data library do it
const { data: orders = [], isLoading, error } = useGetOrdersQuery({ status });
```

RTK Query (or TanStack Query) handles race conditions, caching, deduplication and refetching. If you write `fetch` inside `useEffect` in an app that already has RTK Query, it's almost always a mistake.

### And one I found in my own code: creating components in effects

```jsx
// ❌ A component created inside an effect and stored in state
useEffect(() => {
  setMemoList(memo(List));
}, []);

// ✅ Define it once, at module level
const MemoList = memo(List);
```

Components must be defined **outside** render (and outside effects). Created inside, they're a new type on each run, and React remounts everything below them.

---

## useRef: values that don't re-render, and DOM access

```jsx
function SearchBox() {
  const inputRef = useRef(null);

  return (
    <>
      <input ref={inputRef} />
      <button onClick={() => inputRef.current.focus()}>Focus</button>
    </>
  );
}
```

`ref.current` can be changed freely, and changing it **doesn't** re-render. Perfect for:

```jsx
const timerRef = useRef(null);           // a timer id to clear later
const latestHandler = useRef(handler);   // the latest callback, without re-subscribing
const renderCount = useRef(0);           // debugging
```

Don't read or write `ref.current` **during render** (except to initialize it): the screen wouldn't stay in sync with it. Refs are for event handlers and effects.

---

## useMemo & useCallback: only when it matters

```jsx
const total = useMemo(() => orders.reduce((s, o) => s + o.total, 0), [orders]);
const handleSelect = useCallback((id) => setSelectedId(id), []);
```

Both **cache** something between renders. They're optimizations, and they have a cost: memory, dependency comparisons, and code that's harder to read. Use them in two cases:

**1. The calculation is really expensive.** Sorting/filtering thousands of rows, building chart data. Measure it:

```jsx
console.time('filter');
const visible = filterAndSort(rows, criteria);
console.timeEnd('filter');     // < 1 ms? no useMemo needed
```

**2. You pass the value or function to a memoized child** (`memo(...)`), or it's a dependency of an effect:

```jsx
const OrderRow = memo(function OrderRow({ order, onSelect }) { /* ... */ });

function OrderTable({ orders }) {
  const [selectedId, setSelectedId] = useState(null);

  // Without useCallback, a new function every render → every memo(OrderRow) re-renders anyway
  const handleSelect = useCallback((id) => setSelectedId(id), []);

  return orders.map((o) => <OrderRow key={o.id} order={o} onSelect={handleSelect} />);
}
```

Wrapping `` `${a} ${b}` `` or `items.length > 0` in `useMemo` makes the code slower and harder to read. Most of my 42 `useMemo` could simply be removed.

---

## The rules of hooks (and why)

```jsx
// ❌ Hook inside a condition
if (isAdmin) {
  const [users, setUsers] = useState([]);
}

// ❌ Hook after an early return
if (!order) return null;
const [tab, setTab] = useState('details');
```

React doesn't know hooks by name — it knows them by **call order**: "the 1st `useState` of this component, the 2nd...". If a condition skips one, every hook after it gets the wrong state. So:

1. Call hooks only at the **top level** of a component or a custom hook.
2. Never inside conditions, loops, nested functions, or after an early `return`.
3. Call them only from React components or custom hooks (functions named `useSomething`).

The ESLint plugin `eslint-plugin-react-hooks` checks both rules. It's included in the Vite React template — keep it.

---

## Quick decision table

| I want to... | Use |
|---|---|
| Show a value that changes | `useState` |
| Compute something from props/state | A plain variable in render (`useMemo` if expensive) |
| React to a click, submit, input | The event handler |
| Load data from the API | RTK Query / TanStack Query |
| Reset state when an id changes | `key={id}` on the component |
| Subscribe to something outside React (socket, timer, browser API) | `useEffect` with cleanup |
| Keep a value without re-rendering, or reach a DOM node | `useRef` |
| Pass a stable function to a `memo` child | `useCallback` |

---

## Key rules to remember

| Rule | Why |
|---|---|
| A component runs on every render — keep render pure | Predictable UI, no side effects in calculations |
| Use the function form `setX(x => ...)` for updates based on the old value | Several updates in a row work correctly |
| Never mutate state objects — create new ones | React compares references |
| Effects are for syncing with the outside world, with a cleanup | No leaks, no duplicate subscriptions |
| Derived values are computed, not stored | No extra render, never out of sync |
| Events go in handlers, not in effects | Clear cause → effect, fewer bugs |
| Don't fetch in `useEffect` when you have RTK Query | Race conditions, caching and loading handled for you |
| `key` to reset a component | Simpler than syncing props into state |
| `useMemo`/`useCallback` only for expensive work or `memo` children | Optimizations have a cost |
| Hooks at the top level, always in the same order | That's how React matches state to hooks |
| Keep `react-hooks` ESLint rules on | They catch missing dependencies and broken rules |

>
> ## That's it & see you soon!.
>
