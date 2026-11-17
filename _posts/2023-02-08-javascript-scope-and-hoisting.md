---
layout: post
title: "Scope and hoisting in JavaScript - var, let, const and the temporal dead zone"
date: 2023-02-08
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript']
categories: ['Javascript']
description: 'Scope and hoisting in JavaScript - var, let, const and the temporal dead zone'
image: /images/covers/javascript-scope-and-hoisting.png
---

`console.log(x)` before `x` is declared. With `var`, it prints `undefined`. With `let`, it throws `ReferenceError`. With a function declaration, the function runs just fine. Same line, three behaviors — and it all comes from two concepts: **scope** (where a name is visible) and **hoisting** (what JavaScript does before running your code). In the [closures post](/blog/2023/01/11/javascript-closures-explained) we saw that functions remember the variables of their scope. Today, let's look at the scopes themselves.

## The core idea: scope = where a name is visible

```js
const appName = 'Shop';              // global scope

function showOrder(id) {             // function scope
  const label = `Order #${id}`;

  if (id > 100) {                    // block scope
    const vip = true;
    console.log(appName, label, vip);   // ✅ sees all three
  }

  console.log(vip);                  // ❌ ReferenceError: vip is not defined
}
```

Scopes are nested like boxes. Code inside a box can see its own names and the names of all the boxes **around** it — never the boxes inside.

```sql
┌─ global ──────────────────── appName ─┐
│ ┌─ showOrder ─────────── id, label ─┐ │
│ │ ┌─ if block ──────────── vip ───┐ │ │
│ │ │  sees: vip, id, label, appName │ │ │
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

> **Scope is decided by where you WRITE the code, not where you call it.** That's called lexical scope — and it's why closures work.

---

## Three kinds of scope

| Scope | Created by | Who uses it |
|---|---|---|
| Global | The top of a script | Everything — avoid putting things here |
| Function | Every function | `var`, `let`, `const`, parameters |
| Block | `{ }` of `if`, `for`, `while`, or a plain `{ }` | `let`, `const` (and class declarations) — **not `var`** |

(ES modules add a **module scope**: top-level variables in a module are visible in that file only, not global. More on that later this year.)

---

## var vs let vs const

```js
function demo() {
  if (true) {
    var a = 1;
    let b = 2;
    const c = 3;
  }
  console.log(a);   // 1          — var ignores the block
  console.log(b);   // ReferenceError — let stays in the block
  console.log(c);   // ReferenceError
}
```

| | `var` | `let` | `const` |
|---|---|---|---|
| Scope | Function | Block | Block |
| Can be reassigned | ✅ | ✅ | ❌ |
| Can be redeclared in the same scope | ✅ (silently!) | ❌ SyntaxError | ❌ SyntaxError |
| Before its declaration | `undefined` | ReferenceError (TDZ) | ReferenceError (TDZ) |
| New variable per loop iteration | ❌ | ✅ | ✅ |
| Creates a property on `window` (at the top of a script) | ✅ | ❌ | ❌ |

`var` redeclaration is a real source of bugs in long files:

```js
var total = 0;
// ... 200 lines later, someone else writes:
var total = calculateDiscount();   // no error, the first total is silently overwritten
```

---

## Hoisting: what JavaScript does before running your code

Before executing a scope, the JavaScript engine reads it and **registers every declaration** in it. Then it runs the code line by line. That first pass is what people call "hoisting" — as if declarations were moved to the top.

But each kind of declaration is registered **differently**.

### var: hoisted and initialized to undefined

```js
console.log(price);   // undefined (no error!)
var price = 10;
console.log(price);   // 10
```

What the engine effectively does:

```js
var price;            // declaration registered, value = undefined
console.log(price);   // undefined
price = 10;           // the assignment stays where you wrote it
console.log(price);   // 10
```

Only the **declaration** is hoisted, never the **assignment**. That's why you get `undefined` instead of an error — which hides bugs instead of reporting them.

### let and const: hoisted, but in the temporal dead zone

```js
console.log(price);   // ❌ ReferenceError: Cannot access 'price' before initialization
let price = 10;
```

`let` and `const` are registered too (the engine knows they exist), but they're **not initialized**. From the start of the block until the declaration line, the variable is in the **temporal dead zone (TDZ)**: any access throws.

The proof that they *are* hoisted:

```js
let currency = 'EUR';

function show() {
  console.log(currency);   // ❌ ReferenceError — not 'EUR'!
  let currency = 'USD';
}
```

If `let` weren't hoisted, `console.log` would find the outer `currency`. Instead, the inner one already "owns" the name in this function, and it's still in the TDZ. The error is loud — and that's a good thing.

### Function declarations vs expressions

```js
greet('Alice');                       // ✅ works

function greet(name) {                // declaration: hoisted WITH its body
  console.log(`Hello ${name}`);
}
```

```js
sayHi('Alice');                       // ❌ TypeError: sayHi is not a function (with var)
                                      // ❌ ReferenceError (with let/const)

var sayHi = function (name) {         // expression: only the variable is hoisted
  console.log(`Hi ${name}`);
};

const sayBye = (name) => console.log(`Bye ${name}`);   // same: arrow functions are expressions
```

| Declaration | Hoisted | Usable before its line? |
|---|---|---|
| `function f() {}` | Name + body | ✅ Yes |
| `var f = function () {}` | Name only (`undefined`) | ❌ TypeError |
| `const f = () => {}` | Name only (TDZ) | ❌ ReferenceError |
| `class C {}` | Name only (TDZ) | ❌ ReferenceError |

Function declarations being fully hoisted is actually useful: you can put the main logic at the top of a file and the helper functions below.

```js
main();

function main() {
  const data = load();
  render(transform(data));
}

function load() { /* ... */ }
function transform(d) { /* ... */ }
function render(d) { /* ... */ }
```

---

## Shadowing and the scope chain

When JavaScript looks for a name, it starts in the **current** scope and walks **outwards** until it finds it — the **scope chain**. The first match wins:

```js
const status = 'global';

function outer() {
  const status = 'outer';      // shadows the global one

  function inner() {
    console.log(status);       // 'outer' — the closest one
  }
  inner();
}
```

Shadowing is legal, but it makes code harder to read. A common accidental one:

```js
const orders = await fetchOrders();

orders.forEach((orders) => {     // the parameter shadows the array 😬
  console.log(orders.id);
});
```

ESLint's `no-shadow` rule catches these.

---

## Accidental globals

Assigning to a variable that was never declared creates a **global** — silently:

```js
function calculate() {
  totl = 42;          // typo: no let/const/var
}
calculate();
console.log(window.totl);   // 42 — a new global variable 😱
```

Two things protect you:

- **`'use strict';`** at the top of a script turns this into a `ReferenceError`.
- **ES modules** (`<script type="module">`, and everything bundled by Vite/webpack) are **always** in strict mode. In modern projects you get the protection for free.

---

## const doesn't mean immutable

```js
const user = { name: 'Alice' };

user.name = 'Bob';      // ✅ allowed — the object changes
user = { name: 'Bob' }; // ❌ TypeError — the VARIABLE can't point to another object
```

`const` protects the **binding** (the variable always points to the same thing), not the **content**. For objects and arrays, the content can still change. If you need a frozen object, use `Object.freeze(user)` (shallow) — or, better, the immutable habits we'll cover in the functional programming posts.

---

## Practical rules for modern code

```sql
1. const by default
2. let when the variable really needs to change (counters, accumulators)
3. never var
4. declare variables at the top of the block where they're used, as close as possible to their first use
5. function declarations for named helpers, arrows for callbacks
6. ES modules / strict mode everywhere
```

With these rules, hoisting almost never surprises you: `const`/`let` throw clear errors instead of giving `undefined`, and accidental globals are impossible.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Scope is lexical: decided by where code is written | Explains what a function can see (and closures) |
| `let`/`const` are block-scoped, `var` is function-scoped | `var` leaks out of `if` and `for` blocks |
| Declarations are hoisted, assignments are not | `var` gives `undefined` before its line |
| `let`/`const` are in the TDZ until their declaration | Loud `ReferenceError` instead of a silent `undefined` |
| Function declarations are hoisted with their body | Callable before their line — expressions and arrows are not |
| The closest scope wins (shadowing) | Avoid reusing names in nested scopes |
| Strict mode / modules prevent accidental globals | A typo becomes an error, not a global |
| `const` locks the variable, not the object | Use `Object.freeze` or immutable updates for content |
| `const` by default, `let` if needed, never `var` | Fewer surprises, clearer intent |

>
> ## That's it & see you soon!.
>
