---
layout: post
title: "Closures explained - JavaScript, with simple examples"
date: 2023-01-11
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'React']
categories: ['Javascript']
description: 'Closures explained - JavaScript, with simple examples'
image: /images/covers/javascript-closures-explained.png
---

Closures are everywhere in JavaScript: every callback, every event handler, every React hook uses them. Yet the word scares people, and the bugs they cause — a loop that prints `3, 3, 3`, a React interval stuck on an old value — look like magic. There's no magic. A closure is one simple rule, and once you see it, you'll see it in every line of JavaScript you write. Let's start very small, then go to the real uses and the classic traps.

## The core idea: a function + the variables it was born with

```js
function makeGreeter(name) {
  return function greet() {
    console.log(`Hello ${name}`);
  };
}

const greetAlice = makeGreeter('Alice');
greetAlice();   // "Hello Alice"
```

`makeGreeter` has **finished** running when we call `greetAlice()`. Its local variable `name` should be gone... but `greet` still sees it. That's a closure:

```sql
greetAlice = ┌──────────────────────────────┐
             │ function greet() { ... }      │
             │ + its scope:  { name: 'Alice' }│   ← kept alive as long as greetAlice exists
             └──────────────────────────────┘
```

> **A closure is a function together with the variables that were in scope where it was created. The function carries them with it, wherever it goes.**

Every function in JavaScript is a closure. Most of the time you don't notice, because the variables are still around anyway. It becomes visible when the function **outlives** the place where it was created: returned, passed as a callback, stored in an event handler.

---

## Simple example 1 — a counter

```js
function createCounter() {
  let count = 0;

  return function increment() {
    count += 1;
    return count;
  };
}

const counterA = createCounter();
const counterB = createCounter();

counterA();   // 1
counterA();   // 2
counterB();   // 1   ← its own count
counterA();   // 3
```

Each call of `createCounter` creates a **new** `count` variable, and the returned function keeps **its own** one. `counterA` and `counterB` don't share anything.

And nobody else can touch `count`: there's no `counterA.count`. The variable is **private** — only `increment` can change it.

---

## Simple example 2 — a function factory

```js
function makeMultiplier(factor) {
  return (x) => x * factor;
}

const double = makeMultiplier(2);
const triple = makeMultiplier(3);

double(5);   // 10
triple(5);   // 15

[1, 2, 3].map(double);   // [2, 4, 6]
```

`factor` is "baked into" each function. This is how you create small, specialized functions from a general one — the base of many functional programming patterns we'll see later this year.

---

## Closures capture VARIABLES, not values

This is the part that surprises people:

```js
let message = 'Hello';
const say = () => console.log(message);

message = 'Goodbye';
say();   // "Goodbye" — not "Hello"
```

The closure doesn't copy the **value** of `message` when it's created. It keeps a **reference to the variable**. When the function runs, it reads whatever the variable contains **at that moment**.

```sql
say ──► variable "message" ──► currently 'Goodbye'
```

Remember this one — it explains the next two traps.

---

## The loop trap: var vs let

The most famous closure bug:

```js
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// 3, 3, 3   😱
```

Three functions are created, but with `var` there is only **one** variable `i` for the whole loop (it's function-scoped). By the time the timeouts run, the loop is finished and `i` is `3`. All three closures read the same variable.

```js
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// 0, 1, 2   ✅
```

With `let`, JavaScript creates a **new `i` for each iteration**. Each closure captures its own variable. That's one of the reasons `let` and `const` replaced `var` — use them everywhere.

(Before `let` existed, people fixed this with an IIFE — `(function (j) { setTimeout(() => console.log(j), 100); })(i);` — to create a new scope per iteration. You'll still see it in old code.)

---

## Real uses

### Private state: the module pattern

Before classes had private fields, closures were **the** way to hide data:

```js
function createCart() {
  const items = [];                     // private

  return {
    add(product, qty = 1) {
      items.push({ product, qty });
    },
    total() {
      return items.reduce((sum, i) => sum + i.product.price * i.qty, 0);
    },
    count() {
      return items.length;
    },
  };
}

const cart = createCart();
cart.add({ name: 'Keyboard', price: 49 });
cart.total();   // 49
cart.items;     // undefined — can't be reached from outside
```

Today classes can do it too with private fields (`#items`, standardized in ES2022). Both are fine — closures are often shorter for small objects.

### Event handlers and callbacks

```js
function setupDeleteButtons(orders) {
  orders.forEach((order) => {
    const button = document.querySelector(`#delete-${order.id}`);
    button.addEventListener('click', () => {
      deleteOrder(order.id);            // the handler remembers its own order
    });
  });
}
```

Each handler closes over **its** `order`. No `data-id` attributes to read back, no global variable.

### Small utilities: once, memoize, debounce

These classic helpers are just closures holding a bit of state:

```js
// Run a function only the first time
function once(fn) {
  let called = false;
  let result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

const init = once(() => console.log('Initialized'));
init();   // "Initialized"
init();   // nothing
```

```js
// Remember results of an expensive function
function memoize(fn) {
  const cache = new Map();
  return (arg) => {
    if (!cache.has(arg)) cache.set(arg, fn(arg));
    return cache.get(arg);
  };
}

const slowSquare = (n) => { /* imagine heavy work */ return n * n; };
const fastSquare = memoize(slowSquare);
fastSquare(9);   // computed
fastSquare(9);   // from the cache
```

```js
// Wait until the user stops typing for 300 ms
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

searchInput.addEventListener('input', debounce((e) => search(e.target.value)));
```

`called`, `cache`, `timer`: each one is private state, kept alive by the closure, separate for each wrapped function.

---

## React: stale closures

In React, every render creates **new** functions that close over **that render's** variables. That's usually what you want — until a function lives longer than its render:

```jsx
function Timer() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1);      // ❌ "count" is the value from the FIRST render: always 0
    }, 1000);
    return () => clearInterval(id);
  }, []);                        // the effect runs once → the interval keeps the first closure

  return <p>{count}</p>;        // 0, 1, 1, 1, 1...
}
```

The interval's callback was created during the first render, where `count` is `0`. It keeps calling `setCount(0 + 1)` forever. That's a **stale closure**: a function holding on to old variables.

Two fixes:

```jsx
// ✅ 1. Don't read the variable: use the functional update
setCount((c) => c + 1);

// ✅ 2. Or re-create the interval when count changes
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, [count]);
```

The functional update is the better one here. Whenever a callback in React shows an "old" value, look for a closure created in an earlier render — and check the dependency array.

---

## Memory: what a closure keeps alive

A closure keeps its variables alive **as long as the function itself is reachable**. Usually that's exactly right. It becomes a leak when the function is stored somewhere long-lived:

```js
function attachHandler() {
  const bigData = new Array(1_000_000).fill('*');    // ~8 MB

  window.addEventListener('resize', () => {
    console.log(bigData.length);                      // keeps bigData alive...
  });
}                                                      // ...forever, because the listener is never removed
```

Rules of thumb:

- Remove event listeners and clear timers when you don't need them anymore (in React: the effect cleanup).
- Don't capture big objects you don't need — capture only the value you use (`const length = bigData.length;`).
- Closures themselves are cheap. Leaks come from **long-lived references** to them.

---

## Key rules to remember

| Rule | Why |
|---|---|
| A closure = a function + the variables in scope where it was created | It's how every callback "remembers" |
| Closures capture variables, not values | The function sees the current value when it runs |
| Use `let`/`const`, never `var` in loops | `let` creates a new variable per iteration |
| Each call of a factory creates new variables | `createCounter()` twice = two independent counters |
| Closures give truly private state | Nothing outside can reach the variables |
| `once`, `memoize`, `debounce` are closures with a bit of state | Small, reusable, no globals |
| React: old values in callbacks = stale closure | Use functional updates or correct dependencies |
| Clean up listeners and timers | A forgotten closure keeps its variables in memory |

>
> ## That's it & see you soon!.
>
