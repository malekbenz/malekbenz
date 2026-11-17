---
layout: post
title: "Functional programming in JavaScript (2) - map, filter and reduce with real examples"
date: 2023-05-10
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'React']
categories: ['Javascript']
description: 'Functional programming in JavaScript (2) - map, filter and reduce with real examples'
image: /images/covers/javascript-map-filter-reduce.png
---

Last month we saw the two habits of functional programming: [pure functions and immutable data](/blog/2023/04/12/javascript-functional-programming-pure-functions-immutability). Today we put them to work with the three array methods you'll use every single day: `map`, `filter` and `reduce`. They replace most `for` loops with code that says **what** you want instead of **how** to do it — and they never change the original array. Let's go from very simple examples to real data transformations: totals per customer, lookups by id, API data turned into chart data.

## The core idea: describe WHAT, not HOW

The same task, two ways: "the names of the paid orders, in uppercase".

```js
// HOW: a loop, an index, a temporary array, a push
const names = [];
for (let i = 0; i < orders.length; i++) {
  if (orders[i].status === 'paid') {
    names.push(orders[i].customer.toUpperCase());
  }
}

// WHAT: keep the paid ones, take their customer name in uppercase
const names = orders
  .filter((o) => o.status === 'paid')
  .map((o) => o.customer.toUpperCase());
```

The second version reads like the sentence. No index to get wrong, no temporary array, and `orders` is untouched.

```js
const orders = [
  { id: 1, customer: 'Alice', status: 'paid',    total: 120 },
  { id: 2, customer: 'Bob',   status: 'new',     total: 80  },
  { id: 3, customer: 'Alice', status: 'paid',    total: 45  },
  { id: 4, customer: 'Chloé', status: 'shipped', total: 200 },
];
```

(We'll use this array in all the examples.)

> **map changes each item, filter chooses items, reduce combines items. Almost every list transformation is a mix of these three.**

---

## map: transform every item

```sql
[ a,    b,    c    ]
  ↓     ↓     ↓       fn
[ f(a), f(b), f(c) ]   ← always the SAME length
```

```js
const totals = orders.map((o) => o.total);
// [120, 80, 45, 200]

const labels = orders.map((o) => `#${o.id} — ${o.customer}`);
// ['#1 — Alice', '#2 — Bob', ...]

const withTax = orders.map((o) => ({ ...o, totalWithTax: o.total * 1.2 }));
// new objects, the originals are unchanged
```

The callback also receives the **index**: `orders.map((o, i) => ...)`.

In React, `map` is how you render a list:

```jsx
<ul>
  {orders.map((o) => <li key={o.id}>{o.customer}: {o.total} €</li>)}
</ul>
```

---

## filter: keep some items

```sql
[ a, b, c, d ]   → keep when fn(x) is true →   [ a, c ]   ← same items, maybe fewer
```

```js
const paid = orders.filter((o) => o.status === 'paid');
const big  = orders.filter((o) => o.total >= 100);
const notBob = orders.filter((o) => o.customer !== 'Bob');   // the immutable "remove"
```

`filter` returns the **same objects** (not copies) — only the array is new.

---

## reduce: combine everything into one value

`reduce` is the most powerful of the three, and the one that scares people. It walks the array with an **accumulator**:

```sql
reduce((acc, item) => newAcc, initialValue)

initial: 0
  + 120 → 120
  +  80 → 200
  +  45 → 245
  + 200 → 445   ← result
```

```js
const revenue = orders.reduce((sum, o) => sum + o.total, 0);
// 445
```

The accumulator can be **anything**: a number, a string, an array, an object.

```js
// The biggest order
const biggest = orders.reduce((max, o) => (o.total > max.total ? o : max));

// Count orders per status → an object
const countByStatus = orders.reduce((acc, o) => {
  acc[o.status] = (acc[o.status] ?? 0) + 1;
  return acc;
}, {});
// { paid: 2, new: 1, shipped: 1 }
```

"Wait, `acc[o.status] = ...` is a mutation!" — yes, but of the accumulator that `reduce` created **for this call** (the `{}` we passed). It's local to the calculation; nothing outside can see it. That's the "local mutation is fine" rule from part 1.

---

## Chaining: filter → map → reduce

```js
// Revenue from paid orders, with tax
const paidRevenueWithTax = orders
  .filter((o) => o.status === 'paid')     // [order 1, order 3]
  .map((o) => o.total * 1.2)              // [144, 54]
  .reduce((sum, t) => sum + t, 0);        // 198
```

Read it top to bottom like a recipe. Put `filter` **first**: there's no reason to transform items you're going to throw away.

---

## The friends: find, some, every, flatMap, includes

| Method | Returns | Example |
|---|---|---|
| `find(fn)` | The **first** matching item, or `undefined` | `orders.find((o) => o.id === 3)` |
| `findIndex(fn)` | Its index, or `-1` | `orders.findIndex((o) => o.id === 3)` |
| `some(fn)` | `true` if **at least one** matches | `orders.some((o) => o.status === 'new')` |
| `every(fn)` | `true` if **all** match | `orders.every((o) => o.total > 0)` |
| `includes(x)` | `true` if the value is in the array | `['paid', 'shipped'].includes(o.status)` |
| `flatMap(fn)` | `map` + flatten one level | orders → all their lines |
| `at(i)` | Item at index, negative from the end | `orders.at(-1)` (the last one) |

`some`, `every` and `find` **stop** as soon as they know the answer — faster than a `filter(...).length > 0`.

```js
const allLines = ordersWithLines.flatMap((o) => o.lines);   // [[l1, l2], [l3]] → [l1, l2, l3]
```

---

## Real transformations

### Totals per customer (group by)

```js
const totalPerCustomer = orders.reduce((acc, o) => {
  acc[o.customer] = (acc[o.customer] ?? 0) + o.total;
  return acc;
}, {});
// { Alice: 165, Bob: 80, Chloé: 200 }
```

Group the orders themselves (not only the totals):

```js
const ordersByCustomer = orders.reduce((acc, o) => {
  (acc[o.customer] ??= []).push(o);
  return acc;
}, {});
// { Alice: [order1, order3], Bob: [order2], Chloé: [order4] }
```

(`??=` assigns only if the value is `null`/`undefined` — ES2021. A built-in `groupBy` is on its way to the language, but `reduce` works everywhere today.)

### A lookup by id

Searching with `find` inside a loop is slow: for each item, it scans the whole other array.

```js
// ❌ For 5,000 lines and 1,000 products: up to 5 million comparisons
const enriched = lines.map((l) => ({ ...l, product: products.find((p) => p.id === l.productId) }));

// ✅ Build a lookup once, then each access is instant
const productsById = new Map(products.map((p) => [p.id, p]));
const enriched = lines.map((l) => ({ ...l, product: productsById.get(l.productId) }));
```

`new Map(array.map(x => [key, x]))` — or `Object.fromEntries(...)` if you prefer a plain object — is one of the most useful patterns in front-end code.

### API data → chart data

The API returns orders; the chart wants revenue per month, sorted:

```js
const revenueByMonth = Object.entries(
  orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => {
      const month = o.date.slice(0, 7);            // '2023-04-18' → '2023-04'
      acc[month] = (acc[month] ?? 0) + o.total;
      return acc;
    }, {})
)
  .map(([month, total]) => ({ month, total }))
  .sort((a, b) => a.month.localeCompare(b.month));
// [{ month: '2023-03', total: 1830 }, { month: '2023-04', total: 2210 }, ...]
```

Filter, group with `reduce`, turn the object into an array with `Object.entries`, reshape with `map`, sort. (Sorting is fine here: the array was created by `map` two lines above, it's ours.)

---

## Common mistakes

```js
// ❌ 1. Braces without return: map returns [undefined, undefined, ...]
orders.map((o) => { o.total * 1.2 });
// ✅
orders.map((o) => o.total * 1.2);
orders.map((o) => { return o.total * 1.2; });

// ❌ 2. Returning an object literal without parentheses
orders.map((o) => { id: o.id });        // braces = function body → undefined
// ✅
orders.map((o) => ({ id: o.id }));

// ❌ 3. reduce without an initial value on a possibly empty array
[].reduce((sum, x) => sum + x);         // TypeError: Reduce of empty array with no initial value
// ✅
[].reduce((sum, x) => sum + x, 0);      // 0

// ❌ 4. Mutating items inside map
orders.map((o) => { o.total *= 1.2; return o; });   // changes the original orders!
// ✅
orders.map((o) => ({ ...o, total: o.total * 1.2 }));

// ❌ 5. Using map for side effects (and ignoring the result)
orders.map((o) => console.log(o));
// ✅ forEach is for side effects
orders.forEach((o) => console.log(o));
```

---

## Performance: when a for loop is better

A chain `filter → map → reduce` walks the array three times and creates two temporary arrays. For a few thousand items, it doesn't matter at all — readability wins. Consider a plain loop (or a single `reduce`) when:

- the array has **hundreds of thousands** of items, in a hot path;
- you need to **stop early** in a way `find`/`some` can't express;
- profiling shows the chain is really the bottleneck.

Measure first. Most of the time, the slow part is the network or the rendering, not `map`.

---

## Key rules to remember

| Rule | Why |
|---|---|
| `map` = same length, transformed items | One output per input |
| `filter` = same items, maybe fewer | Choosing, including the immutable "remove" |
| `reduce` = one value from many, always give an initial value | Sums, max, objects; no crash on empty arrays |
| Chain `filter` first, then `map`, then `reduce` | Don't transform what you'll throw away |
| `find`, `some`, `every` stop early | Faster than filtering everything |
| Build a `Map` by id instead of `find` in a loop | From quadratic to linear |
| Return values: watch braces and object literals | `{}` is a function body, `({})` is an object |
| Never mutate items in `map` — spread instead | The original data stays intact |
| `forEach` for side effects, `map` for new arrays | Say what you mean |
| Readability first, loops only for measured hot paths | Most bottlenecks are elsewhere |

>
> ## That's it & see you soon!.
>
