---
layout: post
title: "The JavaScript event loop - Call stack, tasks and microtasks explained"
date: 2023-08-09
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript', 'NodeJs']
categories: ['Javascript']
description: 'The JavaScript event loop - Call stack, tasks and microtasks explained'
image: /images/covers/javascript-event-loop-explained.png
---

`setTimeout(fn, 0)` runs **after** a promise callback written below it. A `while` loop of two seconds freezes the whole page — buttons, animations, even the cursor in an input. A spinner you show before a heavy calculation never appears. All three have the same explanation: JavaScript runs on **one thread**, and the **event loop** decides what runs next. Once you can picture it, async JavaScript stops being surprising. Let's build that picture step by step.

## The core idea: one thread, one call stack, queues of work

```sql
 ┌──────────────┐        ┌───────────────────────────────┐
 │  Call stack  │        │  Browser / Node (other threads)│
 │  (your JS,   │  ───►  │  timers, network, disk, events │
 │  one at a    │        └──────────────┬────────────────┘
 │  time)       │                       │ when done, they queue a callback
 └──────▲───────┘                       ▼
        │              ┌──────────────────────────────────┐
        │              │ Microtask queue: promises        │  ← emptied FIRST, completely
        │              ├──────────────────────────────────┤
        └──────────────│ Task queue: timers, events, I/O  │  ← one task at a time
          event loop   └──────────────────────────────────┘
```

The event loop repeats one simple algorithm:

```sql
1. Run the current task until the call stack is empty
2. Run ALL microtasks (including new ones added meanwhile)
3. Let the browser render, if needed
4. Take the next task from the task queue → back to 1
```

> **JavaScript never interrupts running code. A callback only runs when the call stack is empty — that's the one rule behind everything else.**

---

## The call stack

The call stack is the list of functions currently running:

```js
function multiply(a, b) { return a * b; }
function square(n) { return multiply(n, n); }
function printSquare(n) { console.log(square(n)); }

printSquare(4);
```

```sql
step 1: [printSquare]
step 2: [printSquare, square]
step 3: [printSquare, square, multiply]   ← multiply returns 16
step 4: [printSquare, square]             ← square returns 16
step 5: [printSquare, console.log]        ← prints 16
step 6: []                                 ← empty: the event loop can pick the next work
```

One stack, one function at a time. That's why an error shows a **stack trace**: it's a picture of this stack at the moment of the error. And why infinite recursion ends with "Maximum call stack size exceeded".

---

## Web APIs: the waiting happens outside JavaScript

```js
console.log('A');
setTimeout(() => console.log('B'), 1000);
console.log('C');
// A, C, ... (1 second) ... B
```

`setTimeout` doesn't wait. It asks the **browser** to start a timer and returns immediately. The timer runs outside JavaScript; when it fires, the browser puts the callback in the **task queue**. The callback runs later, when the stack is empty.

Same for `fetch` (the network request is done by the browser), `addEventListener` (the browser watches for clicks), file reads in Node, etc. JavaScript is single-threaded, but the **platform** around it is not.

---

## Tasks and microtasks

There are two queues, with different priorities:

| Queue | Filled by | When it runs |
|---|---|---|
| **Task** (macrotask) queue | `setTimeout`, `setInterval`, user events (click, input), network/I/O callbacks, `MessageChannel` | **One** task per loop turn |
| **Microtask** queue | Promise callbacks (`.then`, `await` continuations), `queueMicrotask`, `MutationObserver` | **All** of them, right after the current task — before rendering, before the next task |

### Guess the output

```js
console.log('1 sync');

setTimeout(() => console.log('2 timeout'), 0);

Promise.resolve().then(() => console.log('3 promise'));

queueMicrotask(() => console.log('4 microtask'));

console.log('5 sync');
```

```sql
1 sync
5 sync
3 promise
4 microtask
2 timeout
```

Step by step:

```sql
Current task (the script):  prints "1 sync", schedules the timeout (task queue),
                             schedules 2 microtasks, prints "5 sync". Stack empty.
Microtasks (all of them):    "3 promise", "4 microtask"
Next task:                   "2 timeout"
```

### async/await is microtasks too

```js
async function load() {
  console.log('B');
  await null;               // everything after await = a microtask
  console.log('D');
}

console.log('A');
load();
console.log('C');
// A, B, C, D
```

The code **before** the first `await` runs synchronously. The rest is scheduled as a microtask, so it runs after the current synchronous code (`C`) finishes.

### Microtasks can starve the page

Because the loop empties the microtask queue **completely**, a microtask that keeps adding microtasks never lets anything else run:

```js
function forever() {
  queueMicrotask(forever);   // ❌ the page freezes: no rendering, no clicks, no timers
}
forever();
```

A `setTimeout` loop doesn't have this problem: each call is a separate task, and the browser can render between them.

---

## Rendering: when the browser paints

The browser updates the screen **between tasks**, after microtasks — never in the middle of your JavaScript:

```js
button.addEventListener('click', () => {
  spinner.hidden = false;          // you expect the spinner to appear...
  const result = heavyCalculation(); // ...but this takes 3 seconds on the same stack
  spinner.hidden = true;
  render(result);
});
// The spinner NEVER shows: the browser couldn't paint until the handler finished,
// and by then it's hidden again.
```

Let the browser paint first, then do the work in a **new task**:

```js
button.addEventListener('click', () => {
  spinner.hidden = false;
  setTimeout(() => {                 // new task → the browser renders the spinner in between
    const result = heavyCalculation();
    spinner.hidden = true;
    render(result);
  }, 0);
});
```

For animations, `requestAnimationFrame(callback)` runs your code **right before the next paint** — the right place for visual updates, synced with the screen (usually 60 times per second).

---

## Blocking the loop: long tasks

A 60 Hz screen paints every ~16 ms. Any task longer than that delays a frame; a task of hundreds of milliseconds makes the page feel frozen: clicks wait, typing lags, animations stop. Browsers call tasks over 50 ms **long tasks** (you can see them in the Performance tab of DevTools).

### Fix 1: split the work into chunks

```js
async function processAll(items, processItem) {
  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    items.slice(i, i + CHUNK).forEach(processItem);
    await new Promise((resolve) => setTimeout(resolve, 0));   // yield: let the browser breathe
  }
}
```

Each chunk is short, and between chunks the browser can render and handle clicks. (Note: it's `setTimeout`, a **task** — yielding with `await Promise.resolve()` would be a microtask and wouldn't let the browser render.)

### Fix 2: move the work to another thread

For really heavy work (parsing a big file, image processing, complex calculations), a **Web Worker** runs JavaScript on a separate thread, with its own event loop:

```js
// main.js
const worker = new Worker(new URL('./stats.worker.js', import.meta.url), { type: 'module' });
worker.postMessage(bigDataset);
worker.onmessage = (e) => render(e.data);

// stats.worker.js
self.onmessage = (e) => {
  const result = computeStatistics(e.data);   // heavy, but the page stays responsive
  self.postMessage(result);
};
```

Workers can't touch the DOM, and data is copied between threads — use them for pure computation.

---

## setTimeout(fn, 0) is not 0

```js
setTimeout(() => console.log('timeout'), 0);
```

"0" means "as soon as possible, in a future task" — after the current code, after all microtasks, possibly after rendering and other tasks already waiting. Browsers also enforce a **minimum delay** of about 4 ms for nested timers, and throttle timers heavily in **background tabs** (to about once per second, or less). Never use timers for precise timing.

---

## Node.js: the same idea

Node uses the same model (one JS thread, an event loop, a thread pool for I/O), with a few extra queues:

| Node API | Runs |
|---|---|
| `process.nextTick(fn)` | Before promise microtasks — even higher priority (use sparingly) |
| Promise callbacks | Microtasks, as in the browser |
| `setTimeout` / `setInterval` | Timers phase |
| `setImmediate(fn)` | Check phase, right after I/O callbacks |

The lesson is the same: CPU-heavy synchronous code in a Node server blocks **every** request on that process. Keep handlers async and short; move heavy work to worker threads or another service.

---

## Key rules to remember

| Rule | Why |
|---|---|
| One thread, one call stack — running code is never interrupted | Callbacks only run when the stack is empty |
| Waiting (timers, network, events) happens outside JS | Then a callback is queued |
| Sync code → all microtasks → render → next task | The order behind every "guess the output" |
| Promises / `await` continuations are microtasks | They run before any `setTimeout` |
| Code before the first `await` runs synchronously | `async` doesn't mean "in the background" |
| The browser paints between tasks, never during your code | Show a spinner, then yield before heavy work |
| Tasks over 50 ms make the page feel frozen | Split work into chunks or use a Web Worker |
| Yield with `setTimeout`, not `Promise.resolve()` | Only a new task lets the browser render |
| `setTimeout(fn, 0)` means "later", not "now" | Minimum delays and background throttling |
| Node works the same way | Blocking code blocks every request |

>
> ## That's it & see you soon!.
>
