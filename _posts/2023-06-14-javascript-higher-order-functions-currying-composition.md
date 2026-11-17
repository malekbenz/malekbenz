---
layout: post
title: "Functional programming in JavaScript (3) - Higher-order functions, currying and composition"
date: 2023-06-14
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'React']
categories: ['Javascript']
description: 'Functional programming in JavaScript (3) - Higher-order functions, currying and composition'
image: /images/covers/javascript-higher-order-functions-currying-composition.png
---

In [part 1](/blog/2023/04/12/javascript-functional-programming-pure-functions-immutability) we wrote pure functions, in [part 2](/blog/2023/05/10/javascript-map-filter-reduce) we used `map`, `filter` and `reduce`. This last part is about the idea that makes all of it possible: in JavaScript, **functions are values**. You can pass them, return them, store them — and build big behaviors by combining small functions. Three words describe it: **higher-order functions**, **currying** and **composition**. They sound academic; you'll see they're practical, and you already use them every day.

## The core idea: functions are values

```js
const double = (x) => x * 2;      // a function stored in a variable

const fns = [double, Math.round]; // in an array
const tools = { double };         // in an object

[1, 2, 3].map(double);            // passed as an argument
```

A function is a value like a number or a string. Everything in this post follows from that.

> **A higher-order function takes a function as an argument, returns a function, or both. Currying and composition are just two useful ways of doing that.**

---

## Higher-order functions

### You already use them

```js
orders.map((o) => o.total);                       // map takes a function
button.addEventListener('click', handleClick);    // so does addEventListener
setTimeout(() => save(), 1000);                   // and setTimeout
const debounced = debounce(search, 300);          // debounce RETURNS a function (closures post)
```

### Writing your own: add behavior around any function

A higher-order function can **wrap** another function to add something — logging, timing, retries — without changing it:

```js
// Log every call
const withLogging = (fn, name = fn.name) => (...args) => {
  console.log(`→ ${name}`, args);
  const result = fn(...args);
  console.log(`← ${name}`, result);
  return result;
};

const add = (a, b) => a + b;
const loggedAdd = withLogging(add);
loggedAdd(2, 3);
// → add [2, 3]
// ← add 5
```

```js
// Measure how long an async function takes
const withTiming = (fn, label) => async (...args) => {
  const start = performance.now();
  try {
    return await fn(...args);
  } finally {
    console.log(`${label}: ${(performance.now() - start).toFixed(0)} ms`);
  }
};

const loadOrders = withTiming((status) => fetch(`/api/orders?status=${status}`).then((r) => r.json()), 'loadOrders');
```

```js
// Retry a failing async function
const withRetry = (fn, attempts = 3, delayMs = 500) => async (...args) => {
  for (let i = 1; ; i++) {
    try {
      return await fn(...args);
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs * i));   // wait a bit longer each time
    }
  }
};

const robustLoadOrders = withRetry(loadOrders);
```

They stack:

```js
const loadOrdersSafely = withRetry(withTiming(fetchOrders, 'orders'), 3);
```

The original function stays simple; the extra behaviors are reusable for **any** function. That's the "decorator" idea, written with plain functions.

---

## Currying: one argument at a time

A **curried** function takes its arguments one by one, returning a new function each time:

```js
// Normal
const add = (a, b) => a + b;
add(2, 3);        // 5

// Curried
const addC = (a) => (b) => a + b;
addC(2)(3);       // 5

const add10 = addC(10);   // a new, specialized function
add10(5);         // 15
```

On its own, `addC(2)(3)` looks like a strange way to write `add(2, 3)`. The value appears when you give the **first** arguments now and the **last** one later — typically when the function is passed to `map`, `filter` or `sort`.

### Practical examples

```js
// A reusable filter factory
const byStatus = (status) => (order) => order.status === status;

orders.filter(byStatus('paid'));
orders.filter(byStatus('shipped'));
```

```js
// A reusable sort factory
const sortBy = (key, direction = 'asc') => (a, b) => {
  const result = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
  return direction === 'asc' ? result : -result;
};

[...orders].sort(sortBy('total', 'desc'));
[...customers].sort(sortBy('name'));
```

```js
// Configure once, use everywhere
const formatCurrency = (currency, locale = 'fr-FR') => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  return (amount) => formatter.format(amount);
};

const euros = formatCurrency('EUR');
orders.map((o) => euros(o.total));   // ['120,00 €', '80,00 €', ...]
```

Notice the last one: the `Intl.NumberFormat` object (relatively expensive to create) is built **once** in the outer function, then reused for every amount. Currying is also a simple way to **prepare** work in advance.

### Partial application

Fixing **some** arguments of a normal function is called partial application. Arrows (or `bind`) do it without changing the original:

```js
const calculatePrice = (taxRate, discount, amount) => amount * (1 - discount) * (1 + taxRate);

const retailPrice = (amount) => calculatePrice(0.2, 0, amount);
const vipPrice    = (amount) => calculatePrice(0.2, 0.1, amount);

// Same with bind (the first argument of bind is "this", unused here)
const vipPrice2 = calculatePrice.bind(null, 0.2, 0.1);
```

Rule of thumb for designing such functions: put the arguments that change **least** first (configuration) and the data **last**. That's what makes `byStatus('paid')` and `sortBy('total')` work so naturally with array methods.

---

## Composition: pipe and compose

**Composition** means building a function from smaller ones, where the output of one is the input of the next:

```js
const pipe = (...fns) => (input) => fns.reduce((value, fn) => fn(value), input);
```

Five lines of `reduce` (part 2!) and we have a pipeline tool:

```js
const trim = (s) => s.trim();
const toLower = (s) => s.toLowerCase();
const removeAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const collapseSpaces = (s) => s.replace(/\s+/g, ' ');

const normalizeSearch = pipe(trim, toLower, removeAccents, collapseSpaces);

normalizeSearch('  Hélène   DUBOIS ');   // 'helene dubois'
```

Each step is tiny, pure and testable; the pipeline reads in order, top to bottom. `compose` is the same thing applied **right to left** (`compose(f, g)(x) = f(g(x))`), the math convention — `pipe` is usually easier to read.

### A data pipeline

Combine composition with the curried helpers from above:

```js
const filterBy = (predicate) => (list) => list.filter(predicate);
const mapTo = (fn) => (list) => list.map(fn);
const sumOf = (fn) => (list) => list.reduce((sum, item) => sum + fn(item), 0);

const paidRevenue = pipe(
  filterBy(byStatus('paid')),
  sumOf((o) => o.total),
);

paidRevenue(orders);   // 165
```

The pipeline is a **value**: you can name it, export it, test it with fake data, reuse it on another array.

---

## Point-free style — and when it hurts

Code that never names its data is called "point-free":

```js
const getPaidTotals = pipe(filterBy(byStatus('paid')), mapTo((o) => o.total));
```

Elegant for short pipelines. Over the top, it becomes a puzzle:

```js
const report = pipe(groupBy(prop('customer')), mapValues(pipe(pluck('total'), sum)), toPairs, sortBy(nth(1)), reverse, take(3));
```

Nobody can debug that line at 6 p.m. When a pipeline needs a comment to be understood, go back to named variables:

```js
const totalsByCustomer = groupTotals(orders);
const top3 = Object.entries(totalsByCustomer)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 3);
```

Functional style is a tool for **clarity**. When it stops being clearer, stop.

---

## In React

Higher-order functions are all over React code too.

### Event handler factories (currying)

```jsx
function StatusFilter({ setStatus }) {
  const select = (status) => () => setStatus(status);    // returns a handler

  return (
    <>
      <button onClick={select('all')}>All</button>
      <button onClick={select('paid')}>Paid</button>
      <button onClick={select('shipped')}>Shipped</button>
    </>
  );
}
```

### Higher-order components vs hooks

A **higher-order component** (HOC) is a function that takes a component and returns a new one — the same idea as `withLogging`, for components:

```jsx
const withLoading = (Component) => ({ isLoading, ...props }) =>
  isLoading ? <Spinner /> : <Component {...props} />;

const OrderTableWithLoading = withLoading(OrderTable);
```

HOCs were very common before hooks (Redux's old `connect(...)` was one). Today, **custom hooks** usually replace them — they share logic without wrapping the component tree — but you'll still meet HOCs in libraries and older code.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Functions are values: pass, return, store them | The base of every pattern here |
| Wrap functions to add behavior (`withRetry`, `withTiming`) | Reusable, the original stays simple |
| Curried factories: `byStatus('paid')`, `sortBy('total')` | Specialized functions for `filter`, `sort`, `map` |
| Configuration first, data last | Fits naturally with array methods and pipelines |
| Prepare expensive work in the outer function | Created once, reused for every call |
| `pipe(a, b, c)` for step-by-step transformations | Small pure steps, read top to bottom |
| Name the pipeline, test it like any function | Pipelines are values |
| Stop at point-free puzzles | Clarity is the goal, not cleverness |
| Hooks usually replace HOCs in modern React | Same reuse, simpler tree |

>
> ## That's it & see you soon!.
>
