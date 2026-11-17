---
layout: post
title: "Functional programming in JavaScript (1) - Pure functions, side effects and immutability"
date: 2023-04-12
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'React']
categories: ['Javascript']
description: 'Functional programming in JavaScript (1) - Pure functions, side effects and immutability'
image: /images/covers/javascript-functional-programming-pure-functions-immutability.png
---

A function that calculates an order total — and, on the way, sorts the order's lines in place. Three screens later, the invoice shows the lines in the wrong order, and nobody understands why: the invoice code never sorted anything. Bugs like this come from **hidden changes**: a function that does more than return a value. Functional programming isn't about obscure math words. At its core, it's two habits — **pure functions** and **immutable data** — that remove this whole family of bugs. This first part is about these two habits; next month we'll put them to work with `map`, `filter` and `reduce`.

## The core idea: functions like in math

In math, `f(x) = x * 2` always gives `6` for `3`. It doesn't depend on the time, it doesn't change `x`, it doesn't print anything. A **pure function** follows the same two rules:

```sql
1. Same inputs  →  always the same output
2. No side effects: it changes nothing outside itself
```

```js
// ✅ Pure
const lineTotal = (line) => line.price * line.quantity;

// ❌ Impure: depends on something outside (rule 1)
let taxRate = 0.2;
const withTax = (amount) => amount * (1 + taxRate);

// ❌ Impure: changes something outside (rule 2)
const addLine = (order, line) => {
  order.lines.push(line);          // modifies the caller's object
  return order;
};
```

> **A pure function is a black box: values in, value out. You can understand it, test it and reuse it without looking anywhere else.**

---

## Pure vs impure: how to spot them

A function is impure if it does **any** of these:

| Impure because it... | Example |
|---|---|
| Reads something that can change outside | A global variable, `Date.now()`, `Math.random()` |
| Modifies its arguments | `arr.push(...)`, `obj.x = ...` on a parameter |
| Modifies outside state | Assigns a global, writes `localStorage` |
| Talks to the outside world | `fetch`, `console.log`, DOM changes, timers |

Making `withTax` pure is easy — pass the dependency as a parameter:

```js
const withTax = (amount, taxRate) => amount * (1 + taxRate);

withTax(100, 0.2);   // always 120
```

And the date problem:

```js
// ❌ Different result every day — hard to test
const isExpired = (order) => order.expiresAt < Date.now();

// ✅ The caller gives the time
const isExpired = (order, now) => order.expiresAt < now;

isExpired(order, Date.now());                // in the app
isExpired(order, new Date('2023-01-01'));   // in a test
```

The impurity didn't disappear — `Date.now()` is still called — but it moved **out** of the logic, to the edge of the program.

---

## Side effects: not evil, just in the right place

A program without side effects does nothing useful: no screen, no network, no saved data. The goal isn't to remove them, it's to **separate** them:

```js
// ❌ Logic and side effects mixed
async function checkout(cart) {
  let total = 0;
  for (const item of cart.items) {
    total += item.price * item.qty;
    if (item.qty > 10) item.price *= 0.9;          // mutates the cart!
  }
  document.querySelector('#total').textContent = total;
  await fetch('/api/orders', { method: 'POST', body: JSON.stringify(cart) });
}
```

```js
// ✅ Pure logic...
const discountedPrice = (item) => (item.qty > 10 ? item.price * 0.9 : item.price);
const cartTotal = (items) => items.reduce((sum, i) => sum + discountedPrice(i) * i.qty, 0);

// ...and a thin layer of side effects around it
async function checkout(cart) {
  const total = cartTotal(cart.items);
  document.querySelector('#total').textContent = total;
  await fetch('/api/orders', { method: 'POST', body: JSON.stringify(cart) });
}
```

`cartTotal` can now be tested with a simple `expect(cartTotal([...])).toBe(...)` — no DOM, no network mock. This structure has a name: **functional core, imperative shell**. The core (rules, calculations) is pure; the shell (UI, API calls, storage) is small and boring.

---

## Immutability: don't change data, create new data

Back to the bug from the introduction:

```js
function orderTotal(order) {
  order.lines.sort((a, b) => b.price - a.price);   // 😱 sort() changes the array in place
  return order.lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
```

`orderTotal` looks like a calculation, but it **reorders the caller's array**. Every other part of the app that holds this order now sees sorted lines. In JavaScript, objects and arrays are passed **by reference**: the function receives the same array, not a copy.

```sql
invoice ──┐
          ├──► the SAME lines array in memory  ◄── orderTotal sorts it
cart    ──┘
```

The fix: never modify data you received — create a **new** version instead.

```js
function orderTotal(order) {
  const sorted = [...order.lines].sort((a, b) => b.price - a.price);   // sort a copy
  return sorted.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
```

### Arrays: methods that mutate vs methods that don't

| ❌ Mutates the array | ✅ Returns a new array |
|---|---|
| `push(x)` | `[...arr, x]` or `arr.concat(x)` |
| `unshift(x)` | `[x, ...arr]` |
| `pop()`, `shift()`, `splice(i, 1)` | `arr.filter((_, idx) => idx !== i)`, `arr.slice(...)` |
| `arr[i] = x` | `arr.map((v, idx) => (idx === i ? x : v))` |
| `sort()`, `reverse()` | `[...arr].sort()`, `[...arr].reverse()` |

Common updates, written immutably:

```js
const lines = [{ id: 1, qty: 2 }, { id: 2, qty: 1 }];

const added   = [...lines, { id: 3, qty: 5 }];                                 // add
const removed = lines.filter((l) => l.id !== 2);                               // remove
const updated = lines.map((l) => (l.id === 1 ? { ...l, qty: l.qty + 1 } : l)); // update one
```

(A new set of non-mutating array methods — `toSorted()`, `toReversed()`, `with()` — is arriving with ES2023. We'll look at them at the end of the year.)

### Objects: spread, and nested updates

```js
const order = {
  id: 42,
  status: 'new',
  customer: { name: 'Alice', address: { city: 'Lyon' } },
};

// Change one property
const paid = { ...order, status: 'paid' };

// Change a NESTED property: copy every level on the path
const moved = {
  ...order,
  customer: {
    ...order.customer,
    address: { ...order.customer.address, city: 'Paris' },
  },
};
```

Spread (`...`) makes a **shallow** copy: only the first level is new. That's why nested updates need a spread at each level. Untouched parts (`order.customer.name`) are **shared** between the old and new object — which is fine, as long as nobody mutates them.

### Object.freeze: a safety net

```js
const settings = Object.freeze({ currency: 'EUR', decimals: 2 });
settings.currency = 'USD';    // ignored (TypeError in strict mode)
```

`Object.freeze` is **shallow** too: nested objects can still change. It's useful for constants and configuration; for application data, the habit of not mutating matters more than freezing.

---

## Why React and Redux depend on it

React decides whether something changed by comparing **references**, not contents:

```jsx
const [lines, setLines] = useState([]);

// ❌ Same array, mutated → React sees the same reference → no re-render
lines.push(newLine);
setLines(lines);

// ✅ New array → new reference → re-render
setLines([...lines, newLine]);
```

Same with Redux: reducers must return **new** objects, `useSelector` and `memo` compare references, and the Redux DevTools "time travel" only works because old states are never modified. Redux Toolkit lets you write "mutating" code (`state.lines.push(...)`) — but it's an illusion: the **Immer** library turns it into an immutable update behind the scenes.

```sql
Mutable:   "did it change?" → compare every property, deeply      (slow, error-prone)
Immutable: "did it change?" → oldRef !== newRef                    (instant)
```

Immutability makes change detection **cheap and reliable**. That's the real reason the whole React ecosystem is built on it.

---

## Benefits, summarized

| Habit | You get |
|---|---|
| Pure functions | Easy tests, no hidden dependencies, safe to reuse and to memoize |
| Side effects at the edges | Small, clear places where things can go wrong |
| Immutable data | No "who changed my array?" bugs, cheap change detection, undo/history for free |

And the cost? Creating new objects instead of changing existing ones uses a bit more memory and CPU. For UI data (lists of hundreds or thousands of items), it's negligible. For huge datasets in tight loops, mutate **locally** inside a function — a function that mutates only its own local variables is still pure from the outside.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Same inputs → same output, no side effects | That's a pure function |
| Pass time, randomness and config as parameters | Logic stays pure and testable |
| Functional core, imperative shell | Logic is pure, side effects are thin and at the edges |
| Never mutate arguments or shared data | Objects and arrays are shared by reference |
| `sort`, `reverse`, `splice`, `push` mutate — copy first | The source of many "who changed this?" bugs |
| Spread for updates, one spread per nested level | Shallow copies need care with nested data |
| React and Redux compare references | Mutation = no re-render, broken DevTools |
| Local mutation inside a function is fine | Purity is about what the caller can see |

>
> ## That's it & see you soon!.
>
