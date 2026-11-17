---
layout: post
title: "Modern JavaScript syntax - Destructuring, spread, optional chaining and nullish coalescing"
date: 2023-11-08
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'React']
categories: ['Javascript']
description: 'Modern JavaScript syntax - Destructuring, spread, optional chaining and nullish coalescing'
image: /images/covers/modern-javascript-syntax.png
---

`const { data: { items = [] } = {} } = response ?? {};` — if this line looks like noise, this post is for you. Modern JavaScript (ES2015 to ES2022) added a lot of small syntax features: destructuring, spread and rest, `?.`, `??`, `??=`... Each one is simple, they remove a lot of boilerplate, and React code uses all of them on every line. Let's go through them one by one, always **before → after**, with the real situations where they help — and the traps, like the `||` that turns your `0` into a default value.

## Destructuring objects

Pull properties out of an object into variables:

```js
const order = { id: 42, status: 'paid', total: 120, customer: { name: 'Alice', city: 'Lyon' } };

// Before
const id = order.id;
const status = order.status;

// After
const { id, status } = order;
```

### Rename, defaults, nested, rest

```js
const { status: orderStatus } = order;            // rename → orderStatus
const { discount = 0 } = order;                   // default if undefined → 0
const { customer: { name, city } } = order;       // nested → name, city
const { id, ...rest } = order;                    // rest → { status, total, customer }
```

Two details:

- The **default** applies only when the value is `undefined` — not `null`, not `0`.
- **Nested** destructuring throws if the parent is missing: `const { customer: { name } } = {}` → `TypeError`. Give the parent a default: `const { customer: { name } = {} } = order;`.

### In function parameters

This is where destructuring really shines — named parameters with defaults:

```js
// Before: what was the 3rd argument again?
function createOrder(customerId, lines, express, notes) { /* ... */ }
createOrder(42, lines, true, null);

// After: an options object, destructured
function createOrder({ customerId, lines, express = false, notes = '' } = {}) { /* ... */ }
createOrder({ customerId: 42, lines, express: true });
```

The call is self-explanatory, the order of options doesn't matter, and adding a new option doesn't break existing calls. The `= {}` at the end allows calling `createOrder()` with no argument at all.

In React, every component destructures its props:

```jsx
function OrderCard({ order, onSelect, compact = false }) {
  return <div onClick={() => onSelect(order.id)}>{compact ? order.id : order.customer.name}</div>;
}
```

---

## Destructuring arrays

Arrays are destructured by **position**:

```js
const [first, second] = ['a', 'b', 'c'];       // 'a', 'b'
const [, , third] = ['a', 'b', 'c'];           // skip → 'c'
const [head, ...tail] = [1, 2, 3, 4];          // 1, [2, 3, 4]
const [x = 0] = [];                             // default → 0

// Swap two variables, no temp variable
let a = 1, b = 2;
[a, b] = [b, a];
```

You already use it with hooks — `useState` returns an array **so that you can name** the two parts:

```jsx
const [orders, setOrders] = useState([]);
const [isOpen, setIsOpen] = useState(false);
```

And with `Object.entries`:

```js
for (const [status, count] of Object.entries(countByStatus)) {
  console.log(`${status}: ${count}`);
}
```

---

## Spread and rest: the same three dots

`...` means **spread** (expand into individual items) or **rest** (collect the remaining items), depending on where it's written.

### Spread: expand

```js
const lines = [...oldLines, newLine];                       // copy + add (array)
const merged = [...listA, ...listB];                        // concatenate
const updated = { ...order, status: 'shipped' };            // copy + override (object)
const settings = { ...defaults, ...userSettings };          // later properties win
Math.max(...[3, 9, 4]);                                      // array → arguments: 9
```

Order matters for objects: **the last one wins**. `{ ...defaults, ...userSettings }` = defaults, overridden by the user's choices.

### Rest: collect

```js
function sum(...numbers) {             // all arguments → an array
  return numbers.reduce((s, n) => s + n, 0);
}
sum(1, 2, 3);   // 6
```

A classic React use — take what you need, pass the rest to the DOM element:

```jsx
function Button({ variant = 'primary', children, ...rest }) {
  return <button className={`btn btn-${variant}`} {...rest}>{children}</button>;
}

<Button variant="danger" onClick={remove} disabled={isSaving}>Delete</Button>
// onClick and disabled go to the <button> through ...rest
```

Remember from the [reference vs value post](/blog/2023/10/11/javascript-reference-vs-value): spread copies are **shallow**.

---

## Optional chaining: ?.

Reading deep into data that may be missing:

```js
// Before
const city = order && order.customer && order.customer.address && order.customer.address.city;

// After
const city = order?.customer?.address?.city;      // undefined if anything on the way is null/undefined
```

`?.` stops at the first `null` or `undefined` and returns `undefined` instead of throwing `Cannot read properties of undefined`. It works for:

```js
order?.customer?.name          // properties
order?.lines?.[0]               // array index / dynamic key
order.customer?.getLabel?.()    // method calls: only call if it exists
onChange?.(value)                // optional callback props in React
```

Use it where a value is **legitimately optional** (API data not loaded yet, optional props). Don't sprinkle it everywhere "just in case": `order?.id` on an order that must always exist hides real bugs — an error would be more useful.

---

## Nullish coalescing: ?? vs ||

Defaults with `||` have a trap:

```js
const quantity = input.quantity || 1;     // ❌ quantity 0 → becomes 1!
const label = input.label || 'Untitled';  // ❌ empty string '' → becomes 'Untitled'
const enabled = options.enabled || true;  // ❌ false → becomes true (always true!)
```

`||` falls back on **any falsy value**: `0`, `''`, `false`, `NaN`, `null`, `undefined`. `??` only falls back on **`null` or `undefined`**:

```js
const quantity = input.quantity ?? 1;     // ✅ 0 stays 0
const label = input.label ?? 'Untitled';  // ✅ '' stays ''
const enabled = options.enabled ?? true;  // ✅ false stays false
```

| Value | <code>value &#124;&#124; 'x'</code> | `value ?? 'x'` |
|---|---|---|
| `undefined` | `'x'` | `'x'` |
| `null` | `'x'` | `'x'` |
| `0` | `'x'` ❌ | `0` |
| `''` | `'x'` ❌ | `''` |
| `false` | `'x'` ❌ | `false` |

Rule: for **defaults**, use `??`. Use `||` only when you really mean "anything falsy".

`?.` and `??` work great together:

```js
const city = order?.customer?.address?.city ?? 'Unknown city';
```

---

## Logical assignment: ??=, ||=, &&=

```js
options.timeout ??= 5000;        // set only if null/undefined
cache[key] ??= compute(key);     // compute once, then reuse

title ||= 'Untitled';            // set if falsy
user &&= normalize(user);        // update only if it exists
```

The grouping pattern from the [map/filter/reduce post](/blog/2023/05/10/javascript-map-filter-reduce) uses it:

```js
(groups[o.customer] ??= []).push(o);
```

---

## Template literals

```js
// Before
const message = 'Order #' + order.id + ' for ' + order.customer.name + ': ' + order.total + ' €';

// After
const message = `Order #${order.id} for ${order.customer.name}: ${order.total} €`;
```

Any expression works inside `${...}`, and backtick strings can span **multiple lines**:

```js
const html = `
  <tr>
    <td>${order.id}</td>
    <td>${order.status === 'paid' ? '✅' : '⏳'}</td>
  </tr>`;
```

(Careful with inserting user data into HTML strings: it's an XSS risk. In React, JSX escapes values for you; with plain strings, you must escape them yourself.)

---

## Shorthand properties and computed keys

```js
const id = 42, status = 'paid';

// Before
const o1 = { id: id, status: status, getLabel: function () { return '#' + this.id; } };

// After: shorthand properties and methods
const o2 = { id, status, getLabel() { return `#${this.id}`; } };

// Computed keys: the key comes from an expression
const field = 'email';
const errors = { [field]: 'Required', [`${field}Confirm`]: 'Must match' };
// { email: 'Required', emailConfirm: 'Must match' }
```

Computed keys are what make the generic form handler possible:

```jsx
const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
```

---

## Small helpers worth knowing

```js
const big = 1_000_000;                        // numeric separators (ES2021): easier to read
orders.at(-1);                                // last item (ES2022), instead of orders[orders.length - 1]
Object.entries({ a: 1, b: 2 });               // [['a', 1], ['b', 2]]
Object.fromEntries([['a', 1], ['b', 2]]);     // { a: 1, b: 2 }

// Transform an object's values: entries → map → fromEntries
const prices = { keyboard: 49, mouse: 19 };
const withTax = Object.fromEntries(
  Object.entries(prices).map(([name, price]) => [name, price * 1.2])
);
```

---

## Before → after

| Before | After |
|---|---|
| `const a = o.a; const b = o.b;` | `const { a, b } = o;` |
| `function f(x, y, z, w)` with many options | `function f({ x, y, z = 1 } = {})` |
| `arr.concat([x])`, `Object.assign({}, o, { k: v })` | `[...arr, x]`, `{ ...o, k: v }` |
| `o && o.a && o.a.b` | `o?.a?.b` |
| `x !== null && x !== undefined ? x : d` | `x ?? d` |
| `if (x == null) x = d;` | `x ??= d;` |
| `'a' + b + 'c'` | `` `a${b}c` `` |
| `{ id: id, run: function () {} }` | `{ id, run() {} }` |
| `arr[arr.length - 1]` | `arr.at(-1)` |

---

## Key rules to remember

| Rule | Why |
|---|---|
| Destructure props and options objects | Clear names, defaults in one place |
| Give nested destructuring a parent default (`= {}`) | No TypeError on missing data |
| Options object instead of many positional parameters | Self-documenting calls, easy to extend |
| `...` spreads (expand) or rests (collect) | Same dots, depends on the position |
| In object spread, the last property wins | `{ ...defaults, ...overrides }` |
| `?.` for legitimately optional data only | Don't hide real bugs |
| `??` for defaults, not <code>&#124;&#124;</code> | `0`, `''` and `false` are valid values |
| `??=` to set only when missing | Caches, defaults, grouping |
| Template literals instead of concatenation | Readable, multi-line — but escape HTML yourself |
| Computed keys `[name]` for generic handlers | One `onChange` for every field |

>
> ## That's it & see you soon!.
>
