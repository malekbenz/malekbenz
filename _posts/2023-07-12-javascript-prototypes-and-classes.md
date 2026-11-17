---
layout: post
title: "Prototypes and classes in JavaScript - What class really does"
date: 2023-07-12
author: Malekbenz
comments: true
category: Javascript
tags : [ 'Javascript']
categories: ['Javascript']
description: 'Prototypes and classes in JavaScript - What class really does'
image: /images/covers/javascript-prototypes-and-classes.png
---

JavaScript has a `class` keyword, `extends`, `super`, `static`, private fields... it looks like classes in C# or Java. But underneath, there are no classes: there are **objects linked to other objects**. `class` is a nicer way to write that linking. Most of the time you don't need to care — until a method "disappears" in a callback, a property shows up where you didn't put it, or `instanceof` lies to you. Let's see what really happens, with simple diagrams, then the modern class features you should use today.

## The core idea: objects link to other objects

Every object has a hidden link to another object: its **prototype**. When you read a property that the object doesn't have, JavaScript looks in the prototype, then in the prototype's prototype, and so on. That's the **prototype chain**.

```js
const animal = {
  eats: true,
  describe() { return `${this.name} eats: ${this.eats}`; },
};

const rabbit = Object.create(animal);   // rabbit's prototype = animal
rabbit.name = 'Rabbit';

rabbit.name;        // 'Rabbit'  — own property
rabbit.eats;        // true      — found on animal
rabbit.describe();  // 'Rabbit eats: true' — method from animal, this = rabbit
```

```sql
rabbit                 animal                   Object.prototype          null
┌──────────────┐      ┌───────────────────┐    ┌──────────────────┐
│ name: Rabbit │ ───► │ eats: true        │ ──►│ toString()       │ ──► (end)
└──────────────┘      │ describe()        │    │ hasOwnProperty() │
                      └───────────────────┘    └──────────────────┘
```

> **Reading a property walks up the chain until it's found. Writing a property always writes on the object itself.**

That second rule matters:

```js
rabbit.eats = false;   // creates an OWN property on rabbit
animal.eats;           // still true — the prototype is not changed
```

### Looking at the chain

```js
Object.getPrototypeOf(rabbit) === animal;   // true
Object.hasOwn(rabbit, 'name');              // true  (own)
Object.hasOwn(rabbit, 'eats');              // false (inherited)
'eats' in rabbit;                            // true  (anywhere in the chain)
```

(`Object.hasOwn` is the modern, safer version of `obj.hasOwnProperty(...)` — ES2022. You'll also see `rabbit.__proto__` in old code; prefer `Object.getPrototypeOf`.)

---

## The old way: constructor functions + prototype

Before ES2015, "classes" were written like this — and it's still exactly what happens under `class`:

```js
function Order(id, total) {          // called with "new"
  this.id = id;                      // own properties of each instance
  this.total = total;
}

Order.prototype.withTax = function (rate) {   // ONE method, shared by every instance
  return this.total * (1 + rate);
};

const o1 = new Order(1, 100);
const o2 = new Order(2, 250);

o1.withTax(0.2);                           // 120
o1.withTax === o2.withTax;                 // true — same function, on the prototype
Object.getPrototypeOf(o1) === Order.prototype;   // true
```

What `new Order(1, 100)` does:

```sql
1. Create an empty object
2. Link it to Order.prototype
3. Call Order with this = the new object
4. Return the object
```

```sql
o1 ──► Order.prototype ──► Object.prototype ──► null
{id, total}  { withTax() }
```

---

## class: the same thing, nicer syntax

```js
class Order {
  constructor(id, total) {
    this.id = id;
    this.total = total;
  }

  withTax(rate) {
    return this.total * (1 + rate);
  }
}

typeof Order;                                       // 'function' — it's still a constructor function
Object.getPrototypeOf(new Order(1, 10)) === Order.prototype;   // true
```

Same objects, same chain as before. The differences are mostly safety: a class **must** be called with `new`, its code is always in strict mode, and its methods aren't enumerable.

### extends and super

```js
class Order {
  constructor(id, total) {
    this.id = id;
    this.total = total;
  }
  describe() {
    return `Order #${this.id}: ${this.total} €`;
  }
}

class RecurringOrder extends Order {
  constructor(id, total, everyDays) {
    super(id, total);                 // MUST be called before using "this"
    this.everyDays = everyDays;
  }
  describe() {
    return `${super.describe()} every ${this.everyDays} days`;   // call the parent version
  }
}

new RecurringOrder(7, 30, 14).describe();
// 'Order #7: 30 € every 14 days'
```

```sql
instance ──► RecurringOrder.prototype ──► Order.prototype ──► Object.prototype
{id, total,   { describe() }               { describe() }
 everyDays}
```

`extends` just links one prototype to the other. When we call `describe()`, the lookup finds `RecurringOrder.prototype.describe` first; `super.describe()` explicitly goes one step up the chain.

### Methods on the prototype, fields on the instance

This difference explains a classic bug:

```js
class Counter {
  count = 0;                                 // field  → on EACH instance
  increment() { this.count++; }              // method → on the prototype (shared)
  decrement = () => { this.count--; };       // arrow field → a new function on EACH instance
}
```

| Written as | Lives on | Shared? | `this` when passed as a callback |
|---|---|---|---|
| `method() {}` | The prototype | ✅ One function for all instances | ❌ Lost (see the [this cheat sheet](/blog/2023/03/08/javascript-this-cheat-sheet)) |
| `field = () => {}` | Each instance | ❌ One per instance | ✅ Bound to the instance |

Use methods by default; use arrow fields for methods you'll pass as callbacks (event handlers).

### Static members, getters and setters

```js
class Money {
  static zero = new Money(0, 'EUR');                 // on the class itself

  static fromCents(cents, currency) {                // a factory
    return new Money(cents / 100, currency);
  }

  constructor(amount, currency) {
    this.amount = amount;
    this.currency = currency;
  }

  get formatted() {                                  // read like a property
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: this.currency })
      .format(this.amount);
  }
}

Money.fromCents(1250, 'EUR').formatted;   // '12,50 €'
```

### Private fields and methods (ES2022)

```js
class BankAccount {
  #balance = 0;                               // truly private
  static #count = 0;

  static {                                    // static initialization block
    console.log('BankAccount class ready');
  }

  constructor(owner) {
    this.owner = owner;
    BankAccount.#count++;
  }

  deposit(amount) {
    this.#validate(amount);
    this.#balance += amount;
  }

  get balance() { return this.#balance; }

  #validate(amount) {                         // private method
    if (amount <= 0) throw new RangeError('Amount must be positive');
  }
}

const account = new BankAccount('Alice');
account.deposit(100);
account.balance;      // 100
account.#balance;     // ❌ SyntaxError — not accessible outside the class
```

`#private` is enforced by the **language**, unlike the old `_balance` naming convention (which was just a polite request). It's also an alternative to the closure-based privacy from the [closures post](/blog/2023/01/11/javascript-closures-explained).

---

## instanceof, and a few traps

```js
const r = new RecurringOrder(7, 30, 14);
r instanceof RecurringOrder;   // true
r instanceof Order;            // true — Order.prototype is in r's chain
```

`instanceof` checks "is `X.prototype` somewhere in the chain?". Two traps:

- **Plain data loses the class.** After `JSON.parse` or a `fetch`, your API objects are plain objects: no methods, `instanceof Order` is `false`. Either map them back (`new Order(...)`) or — simpler — keep API data as plain objects and use **functions** on them.
- **Don't modify built-in prototypes.** `Array.prototype.last = function () {...}` affects every array in the app and every library — and can clash with future standard methods. (This is exactly why some new array methods had to get strange names: old libraries had already patched `Array.prototype`.)

---

## Composition over inheritance

Deep `extends` chains (`Entity → Document → Order → RecurringOrder → ...`) become rigid fast: a change in a parent breaks children you forgot about. In JavaScript, it's often simpler to **compose** small pieces:

```js
// Small behaviors as functions
const canBeCancelled = (order) => ({
  cancel: () => ({ ...order, status: 'cancelled' }),
});

const canBePaid = (order) => ({
  pay: (amount) => ({ ...order, paid: amount, status: 'paid' }),
});

// Combine what you need
const createOrder = (data) => ({
  ...data,
  ...canBeCancelled(data),
  ...canBePaid(data),
});
```

Or, even simpler, keep data as plain objects and write **pure functions** that take the data — the style from our functional programming posts. Classes are great for things with real **state and behavior together** (a cache, a connection, a component of a library); for business data from an API, plain objects + functions are usually easier.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Objects link to a prototype; reads walk up the chain | That's all inheritance is in JS |
| Writes always create own properties | The prototype isn't modified by `obj.x = ...` |
| `class` = constructor function + prototype, nicer syntax | Same objects, same chain |
| `super()` before using `this` in a derived constructor | Otherwise a ReferenceError |
| Methods are shared on the prototype, fields are per instance | Explains memory use and lost `this` |
| `#private` fields for real privacy | Enforced by the language, not by naming |
| `Object.hasOwn`, `Object.getPrototypeOf` | Modern, safe inspection |
| Parsed JSON has no class | `instanceof` and methods won't work on API data |
| Never patch built-in prototypes | Global side effects, future clashes |
| Prefer composition and plain objects + functions | Less rigid than deep inheritance |

>
> ## That's it & see you soon!.
>
