---
layout: post
title: "Reference vs value in JavaScript - Copies, equality and why React cares"
date: 2023-10-11
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'React']
categories: ['Javascript']
description: 'Reference vs value in JavaScript - Copies, equality and why React cares'
image: /images/covers/javascript-reference-vs-value.png
---

You copy an object, change the copy... and the original changes too. Two objects with exactly the same content are "not equal". A React effect runs on every render even though "nothing changed". A `useMemo` never seems to cache anything. Four different symptoms, one cause: in JavaScript, **primitives are copied, objects are shared**. We touched it in the [immutability post](/blog/2023/04/12/javascript-functional-programming-pure-functions-immutability); today, the full picture — how copies really work, what `===` compares, and the React bugs it explains.

## The core idea: primitives are copied, objects are shared

```js
// Primitives: number, string, boolean, null, undefined, bigint, symbol
let a = 10;
let b = a;       // b gets a COPY of the value
b = 20;
a;               // 10 — unchanged
```

```js
// Objects (including arrays and functions)
const order = { total: 10 };
const copy = order;     // copy gets the SAME object — not a new one
copy.total = 20;
order.total;            // 20 😱
```

```sql
Primitives:                       Objects:
a ──► [10]                        order ──┐
b ──► [20]   (two boxes)                  ├──► { total: 20 }   (one object)
                                  copy  ──┘
```

A variable never "contains" an object. It contains a **reference** — the address of the object in memory. `const copy = order` copies the **reference**, so both variables point to the same object.

> **Assigning, passing or returning an object never copies it. Only the reference is copied.**

---

## Passing to functions

The same rule applies to function arguments:

```js
function applyDiscount(o) {
  o.total = o.total * 0.9;    // modifies the caller's object
}

const order = { total: 100 };
applyDiscount(order);
order.total;                  // 90
```

```js
function replaceOrder(o) {
  o = { total: 0 };           // only rebinds the LOCAL variable
}

replaceOrder(order);
order.total;                  // still 90
```

Technically, JavaScript always passes **by value** — but for objects, the value is the reference. So the function can **change the object** (both variables point to it), but can't **replace the caller's variable**. That's why "don't mutate your arguments" is the rule from the functional programming posts.

---

## Equality: === compares identity

```js
'abc' === 'abc';                   // true  — same value

const x = { id: 1 };
const y = { id: 1 };
x === y;                           // false — two different objects
[1, 2] === [1, 2];                 // false

const o = { id: 1 };
o === o;                           // true  — the same object
```

For objects, `===` answers "**is it the same object?**", not "do they look the same?". This is the most important fact for React, as we'll see.

`==` doesn't help either: it only converts types for primitives (`'1' == 1`); for objects it's still identity. Use `===` everywhere.

---

## Copying: shallow copies

To get a **new** object, you must create one:

```js
const order = { id: 1, total: 100, customer: { name: 'Alice' }, lines: [{ qty: 2 }] };

const copy1 = { ...order };                 // spread
const copy2 = Object.assign({}, order);     // same thing, older syntax

const arr = [1, 2, 3];
const arrCopy1 = [...arr];
const arrCopy2 = arr.slice();
const arrCopy3 = Array.from(arr);
```

All of these are **shallow**: only the first level is new. Nested objects are still shared:

```js
const copy = { ...order };
copy.total = 50;                // ✅ only the copy changes
copy.customer.name = 'Bob';     // ❌ order.customer.name is 'Bob' too!
```

```sql
order ──► { id, total: 100, customer ──┐, lines ──┐ }
                                       ├──► { name: 'Bob' }
copy  ──► { id, total: 50,  customer ──┘, lines ──┴──► [{ qty: 2 }] }
```

For updates, spread each level you change (the immutable update pattern):

```js
const renamed = { ...order, customer: { ...order.customer, name: 'Bob' } };   // order untouched
```

---

## Deep copies: structuredClone

When you really need a **fully independent** copy (to edit a draft, to keep a snapshot):

```js
const draft = structuredClone(order);
draft.customer.name = 'Bob';
order.customer.name;      // 'Alice' ✅
```

`structuredClone` is built into all modern browsers (since 2022) and Node 17+. It handles nested objects and arrays, `Date`, `Map`, `Set`, and even circular references.

The old trick still works, with traps:

```js
const copy = JSON.parse(JSON.stringify(order));
```

| | `structuredClone` | `JSON.parse(JSON.stringify(x))` |
|---|---|---|
| Nested objects/arrays | ✅ | ✅ |
| `Date` | ✅ stays a Date | ❌ becomes a string |
| `Map`, `Set` | ✅ | ❌ become `{}` |
| `undefined` values | ✅ kept | ❌ removed |
| Circular references | ✅ | ❌ throws |
| Functions, class instances' methods | ❌ throws / prototype lost | ❌ dropped |

Deep copies are expensive on big objects — use them for snapshots and drafts, not as a habit on every update.

---

## Comparing content

Sometimes you really need "do these two objects have the same content?" — for example, to know if a form is dirty:

```js
function isEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) => isEqual(a[key], b[key]));
}

const isDirty = !isEqual(initialValues, currentValues);
```

Deep comparison walks the whole structure: fine for a form, too slow to run on every render of a big list. That's exactly why React doesn't do it.

---

## React: everything is reference equality

React compares with `Object.is` (≈ `===`) everywhere:

| Where | Compared | Consequence |
|---|---|---|
| `setState(newValue)` | Old vs new value | Same reference → **no re-render** |
| `useEffect(..., [deps])` | Each dependency | New reference → **effect runs again** |
| `useMemo` / `useCallback` deps | Each dependency | New reference → **recomputed** |
| `memo(Component)` | Each prop | New reference → **re-renders** |
| Redux `useSelector` | Selected value | New reference → **re-renders** |

### Bug 1: mutating state → no update

```jsx
const [order, setOrder] = useState(initialOrder);

order.status = 'paid';
setOrder(order);                                  // ❌ same object → React skips the update

setOrder({ ...order, status: 'paid' });           // ✅ new object → re-render
```

### Bug 2: a new object every render → endless effects

```jsx
function Orders({ customerId }) {
  const filters = { customerId, status: 'paid' };   // a NEW object on every render

  useEffect(() => {
    loadOrders(filters);
  }, [filters]);                                    // ❌ "changed" every render → runs every render
}
```

`filters` has the same content each time, but it's a **different object** each render. Fixes:

```jsx
// ✅ Depend on the primitives
useEffect(() => {
  loadOrders({ customerId, status: 'paid' });
}, [customerId]);

// ✅ Or keep the same object while its inputs don't change
const filters = useMemo(() => ({ customerId, status: 'paid' }), [customerId]);
```

### Bug 3: memo that never helps

{% raw %}
```jsx
const Row = memo(function Row({ order, onSelect, style }) { /* ... */ });

function Table({ orders }) {
  return orders.map((o) => (
    <Row
      key={o.id}
      order={o}
      onSelect={() => select(o.id)}     // new function every render
      style={{ padding: 8 }}            // new object every render
    />
  ));
}
```
{% endraw %}

Every `Row` gets a new `onSelect` and a new `style` on every render, so `memo` compares, sees "different", and re-renders anyway. Move constants out of the component (`const rowStyle = { padding: 8 };`) and use `useCallback` for handlers passed to memoized children — or don't use `memo` at all if it doesn't measurably help.

---

## Map and Set: identity as keys

```js
const seen = new Set();
seen.add({ id: 1 });
seen.has({ id: 1 });          // false — a different object

const cache = new Map();
const key = { customerId: 42 };
cache.set(key, 'data');
cache.get({ customerId: 42 }); // undefined
cache.get(key);                // 'data'
```

Objects as keys work by **identity**. When you want lookup by content, use a primitive key — the id itself, or a string like `'customer:42'`.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Primitives are copied, objects are shared by reference | `const b = a` never copies an object |
| Functions receive the reference | They can mutate your object — so they shouldn't |
| `===` on objects = same object, not same content | Two identical-looking objects are not equal |
| Spread, `Object.assign`, `slice` are shallow | Nested objects stay shared |
| Update nested data with one spread per level | The original stays intact |
| `structuredClone` for deep copies, not JSON tricks | Keeps Dates, Maps, Sets, handles cycles |
| React compares references everywhere | Mutation = no update, new objects = re-runs |
| Don't create objects/functions in render for deps or memo props | Or they're "new" every render |
| Depend on primitives in effect dependency arrays | Stable, no endless effects |
| Use primitive keys in `Map`/`Set` for lookup by content | Object keys work by identity |

>
> ## That's it & see you soon!.
>
