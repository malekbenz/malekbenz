---
layout: post
title: "Promises and async/await in JavaScript - From callbacks to clean async code"
date: 2023-09-13
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'NodeJs']
categories: ['Javascript']
description: 'Promises and async/await in JavaScript - From callbacks to clean async code'
image: /images/covers/javascript-promises-async-await.png
---

A dashboard loads the user, then the orders, then the stats — one after the other, 3 × 400 ms — when it could load all three at once in 400 ms. A `forEach` with `async` inside "finishes" before any request is done. An error in a promise disappears without a trace. Last month we saw [how the event loop schedules async work](/blog/2023/08/09/javascript-event-loop-explained); today, the tools we use to write it: **promises** and **async/await**. From callbacks to clean code, with the traps that cost hours.

## The core idea: a promise is a value that arrives later

A promise is an object that represents a result **not available yet**: the response of a request, a file being read, a timer. It's in one of three states:

```sql
            ┌──► fulfilled (with a value)
pending ────┤
            └──► rejected  (with an error)
```

Once settled (fulfilled or rejected), it never changes again. You attach what to do **when** it settles:

```js
const promise = fetch('/api/orders');      // starts the request, returns a promise immediately

promise
  .then((response) => response.json())     // when fulfilled
  .then((orders) => console.log(orders))
  .catch((error) => console.error(error))  // when rejected (anywhere above)
  .finally(() => hideSpinner());           // in both cases
```

> **A function returning a promise is saying: "I've started the work. Here's a receipt you can use to get the result later."**

---

## Why promises: callback hell

Before promises, async functions took a **callback**. Three dependent steps looked like this:

```js
getUser(id, (err, user) => {
  if (err) return showError(err);
  getOrders(user.id, (err, orders) => {
    if (err) return showError(err);
    getInvoice(orders[0].id, (err, invoice) => {
      if (err) return showError(err);
      render(user, orders, invoice);       // 3 levels deep, errors handled 3 times
    });
  });
});
```

With promises, the same flow is **flat**, and one `catch` handles errors from every step:

```js
getUser(id)
  .then((user) => getOrders(user.id).then((orders) => ({ user, orders })))
  .then(({ user, orders }) => getInvoice(orders[0].id).then((invoice) => render(user, orders, invoice)))
  .catch(showError);
```

Better — but passing values between steps is still awkward. That's what `async/await` solves.

---

## Creating a promise

Most of the time you **consume** promises (`fetch`, libraries). Sometimes you wrap an old callback API:

```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Cannot load ${src}`));
    img.src = src;
  });
}

await wait(500);
const logo = await loadImage('/img/logo.png');
```

Call `resolve` with the result, `reject` with an **`Error`** (not a string — you want the stack trace).

---

## async/await: the same thing, readable

```js
async function showOrderPage(id) {
  try {
    const user = await getUser(id);
    const orders = await getOrders(user.id);
    const invoice = await getInvoice(orders[0].id);
    render(user, orders, invoice);
  } catch (err) {
    showError(err);
  }
}
```

It reads like synchronous code, variables are simply in scope, and errors use normal `try/catch`. But it's still promises underneath:

- An `async` function **always returns a promise** (`return x` → a promise fulfilled with `x`; `throw` → a rejected promise).
- `await` pauses **this function only**, not the page. The rest of the app keeps running (the code after `await` continues as a microtask).

---

## Error handling

```js
// ✅ try/catch around the awaits
try {
  const orders = await getOrders();
} catch (err) {
  showError(err);
}

// ✅ or .catch on the promise
const orders = await getOrders().catch(() => []);   // fallback value
```

Two things often missed:

**`fetch` doesn't reject on HTTP errors.** A `404` or `500` is a **fulfilled** promise with `response.ok === false`. Only network failures reject.

```js
async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on ${url}`);
  }
  return response.json();
}
```

**Unhandled rejections.** A rejected promise with no `catch` doesn't stop anything — you just get a warning in the console (and in Node, the process may crash). Always end a chain with a `catch`, or `await` it inside a `try`. A global safety net helps for logging:

```js
window.addEventListener('unhandledrejection', (e) => logError(e.reason));
```

---

## Sequential vs parallel: the most common performance bug

```js
// ❌ Sequential: 400 + 400 + 400 = 1200 ms
const user = await getUser(id);
const orders = await getOrders(id);
const stats = await getStats(id);
```

The three requests don't depend on each other, but each `await` waits for the previous one. Start them **all**, then wait:

```js
// ✅ Parallel: max(400, 400, 400) = 400 ms
const [user, orders, stats] = await Promise.all([
  getUser(id),
  getOrders(id),
  getStats(id),
]);
```

Same trap in loops:

```js
// ❌ One request at a time
for (const id of ids) {
  results.push(await getOrder(id));
}

// ✅ All at once
const results = await Promise.all(ids.map((id) => getOrder(id)));
```

Keep the sequential version when each step **needs** the previous result (`getOrders(user.id)`), or when you must limit the load (100 ids → don't fire 100 requests at once; process them in batches of 5–10).

---

## Promise.all, allSettled, race, any

| Method | Fulfills when | Rejects when | Use for |
|---|---|---|---|
| `Promise.all([...])` | **All** fulfill → array of values | **One** rejects (fail fast) | Loading things you need together |
| `Promise.allSettled([...])` | All are settled → `[{status, value/reason}]` | Never | Independent widgets: show what worked |
| `Promise.race([...])` | The **first** to settle (fulfill or reject) | The first settles with an error | Timeouts |
| `Promise.any([...])` | The **first** to fulfill | **All** reject (`AggregateError`) | Fastest of several mirrors/servers |

A dashboard where one failing widget shouldn't break the others:

```js
const results = await Promise.allSettled([getSales(), getStock(), getAlerts()]);

const [sales, stock, alerts] = results.map((r) =>
  r.status === 'fulfilled' ? r.value : null      // null = show "unavailable" in that widget
);
```

---

## Timeouts and cancellation with AbortController

A promise can't be "stopped" by itself — but `fetch` (and many APIs) accept an `AbortSignal`:

```js
const controller = new AbortController();

const promise = fetch('/api/report', { signal: controller.signal });

cancelButton.onclick = () => controller.abort();   // the fetch rejects with an AbortError
```

A timeout in one line (`AbortSignal.timeout` is supported in all modern browsers and Node 18):

```js
const response = await fetch('/api/report', { signal: AbortSignal.timeout(5000) });
```

And the search box classic — cancel the previous request when the user types again, so an old, slow response never overwrites a newer one:

```js
let controller;

async function search(text) {
  controller?.abort();                          // cancel the previous search
  controller = new AbortController();
  try {
    const results = await getJson(`/api/search?q=${encodeURIComponent(text)}`, { signal: controller.signal });
    render(results);
  } catch (err) {
    if (err.name !== 'AbortError') showError(err);   // aborting is not an error for the user
  }
}
```

---

## Common mistakes

```js
// ❌ 1. Forgotten await: you get a Promise, not the data
const orders = getOrders();
orders.length;                       // undefined

// ❌ 2. async inside forEach: forEach doesn't wait
ids.forEach(async (id) => { await saveOrder(id); });
console.log('all saved');            // printed BEFORE any save is done
// ✅
await Promise.all(ids.map((id) => saveOrder(id)));        // parallel
for (const id of ids) { await saveOrder(id); }            // or sequential, if needed

// ❌ 3. Returning inside .then without return
getUser(id).then((user) => { getOrders(user.id); })       // the chain doesn't wait for getOrders
// ✅
getUser(id).then((user) => getOrders(user.id))

// ❌ 4. try/catch that doesn't catch: the promise isn't awaited
try { saveOrder(order); } catch (e) { /* never reached */ }
// ✅
try { await saveOrder(order); } catch (e) { showError(e); }

// ❌ 5. Wrapping a promise in new Promise for nothing
return new Promise((resolve, reject) => fetch(url).then(resolve).catch(reject));
// ✅
return fetch(url);
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| A promise = a value that arrives later (pending → fulfilled/rejected) | The mental model for all async code |
| Prefer `async/await`, with `try/catch` | Flat, readable, normal error handling |
| An `async` function always returns a promise | Callers must `await` it too |
| `await` pauses the function, not the page | The UI keeps running |
| `fetch` doesn't reject on 404/500 — check `response.ok` | Otherwise errors look like success |
| Always handle rejections | Unhandled ones disappear (or crash Node) |
| Independent work → `Promise.all` | 400 ms instead of 1200 ms |
| `allSettled` when partial results are fine | One failure doesn't break everything |
| `AbortController` / `AbortSignal.timeout` for cancel and timeouts | No stale responses, no endless waits |
| Never `async` inside `forEach` | It doesn't wait — use `Promise.all` or `for...of` |

>
> ## That's it & see you soon!.
>
