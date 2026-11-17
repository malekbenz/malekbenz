---
layout: post
title: "this in JavaScript - Cheat sheet: the 4 rules, arrow functions and bind"
date: 2023-03-08
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript']
categories: ['Javascript']
description: 'this in JavaScript - Cheat sheet: the 4 rules, arrow functions and bind'
image: /images/covers/javascript-this-cheat-sheet.png
---

A short one this month — a cheat sheet to keep open next to your editor. `this` in JavaScript is **not** "the object where the function is written". It's decided **when the function is called**, by **how** it's called. Four rules, one exception (arrow functions), and you can predict it every time.

## The 4 rules

```js
const cart = {
  owner: 'Alice',
  show() { console.log(this?.owner); },
};
```

| # | How the function is called | `this` is | Example | Result |
|---|---|---|---|---|
| 1 | As a method: `obj.fn()` | The object before the dot | `cart.show()` | `'Alice'` |
| 2 | Plain call: `fn()` | `undefined` (strict mode / modules) | `const f = cart.show; f()` | `undefined` |
| 3 | Explicit: `call`, `apply`, `bind` | The object you pass | `cart.show.call({ owner: 'Bob' })` | `'Bob'` |
| 4 | With `new` | The new object | `new Cart()` | the instance |

Priority when several apply: **`new` > `bind`/`call`/`apply` > method call > plain call**.

> **Look at the call site, not the definition.** The same function gives a different `this` depending on how it's called.

---

## Rule 3 in detail: call, apply, bind

```js
function greet(greeting, punctuation) {
  return `${greeting}, ${this.name}${punctuation}`;
}

const alice = { name: 'Alice' };

greet.call(alice, 'Hello', '!');     // "Hello, Alice!"   — arguments one by one
greet.apply(alice, ['Hello', '!']);  // "Hello, Alice!"   — arguments as an array
const hi = greet.bind(alice, 'Hi');  // a NEW function, this locked to alice
hi('?');                             // "Hi, Alice?"
```

| Method | Calls now? | Arguments |
|---|---|---|
| `call` | ✅ | `fn.call(thisArg, a, b)` |
| `apply` | ✅ | `fn.apply(thisArg, [a, b])` |
| `bind` | ❌ returns a new function | `fn.bind(thisArg, a)` — `this` can't be changed later |

---

## Arrow functions: no own this

Arrow functions **don't have their own `this`**. They use the `this` of the place where they're **written** (lexical `this`, like a variable from a [closure](/blog/2023/01/11/javascript-closures-explained)). `call`, `apply` and `bind` can't change it.

```js
const timer = {
  seconds: 0,
  start() {
    setInterval(() => {
      this.seconds++;          // ✅ arrow: this = timer (from start())
    }, 1000);
  },
};
```

---

## The lost-this bug

The classic: passing a method as a **callback** turns rule 1 into rule 2.

```js
class Counter {
  count = 0;
  increment() { this.count++; }
}

const counter = new Counter();
button.addEventListener('click', counter.increment);   // ❌ this is the button (or undefined)
setTimeout(counter.increment, 100);                    // ❌ TypeError: cannot read 'count' of undefined
```

`counter.increment` just passes the **function**; the object is forgotten. Three fixes:

```js
// 1. Wrap it in an arrow (the call site is a method call again)
button.addEventListener('click', () => counter.increment());

// 2. Bind it
button.addEventListener('click', counter.increment.bind(counter));

// 3. Define the method as an arrow class field (bound once, per instance)
class Counter {
  count = 0;
  increment = () => { this.count++; };
}
```

Option 3 is popular in UI code; the trade-off is one function per instance instead of one shared on the prototype.

---

## DOM event listeners

With a **regular** function, `this` is the element the listener is attached to:

```js
button.addEventListener('click', function () {
  this.classList.toggle('active');     // this = button
});

button.addEventListener('click', () => {
  this.classList.toggle('active');     // ❌ this = outer this, not the button
});
```

Prefer `event.currentTarget` — it works with both kinds of functions and is clearer:

```js
button.addEventListener('click', (e) => e.currentTarget.classList.toggle('active'));
```

---

## When NOT to use arrows

```js
const cart = {
  owner: 'Alice',
  show: () => console.log(this.owner),   // ❌ this = module scope (undefined), not cart
};
```

| Use a regular function / method | Use an arrow |
|---|---|
| Object methods (`show() {}`) | Callbacks inside methods (`map`, `setTimeout`, promises) |
| Class methods shared on the prototype | Class fields passed as handlers |
| When you need `this` from the call (DOM handler, `call`) | When you want the surrounding `this` |
| Constructors (arrows can't be used with `new`) | Short functions that don't use `this` at all |

---

## Key rules to remember

| Rule | Why |
|---|---|
| `this` is decided at call time, by the call site | Same function, different calls, different `this` |
| `obj.fn()` → `obj`; `fn()` → `undefined` in strict mode | Rules 1 and 2 |
| `call`/`apply` call now, `bind` returns a new function | Rule 3 |
| `new` → the new object | Rule 4, highest priority |
| Arrows use the surrounding `this`, can't be rebound | Perfect for callbacks, wrong for object methods |
| Passing `obj.method` as a callback loses `this` | Wrap in an arrow, `bind`, or use an arrow class field |
| In DOM handlers, prefer `event.currentTarget` | Works with any function style |

>
> ## That's it & see you soon!.
>
