---
layout: post
title: "async/await in C# - What it really does, and the mistakes that cost the most"
date: 2022-03-09
author: Malekbenz
comments: true
category: C#
tags : [ '.Net', 'C#', 'Asp.Net']
categories: ['C#', '.Net']
description: 'async/await in C# - What it really does, and the mistakes that cost the most'
image: /images/covers/csharp-async-await-explained.png
---

"We made the API async and it's not faster." "I added `.Result` and the app froze." "The server has free CPU but requests time out under load." Three real complaints, and the same misunderstanding behind them: `async` doesn't make code **faster**, and it doesn't run things on **another thread**. It lets a thread do **something else while waiting**. Once that's clear, the rules — and the classic bugs — make sense. Let's go through what `async/await` really does, then the mistakes that cost the most in production.

## The core idea: async frees the thread while waiting

A web server has a limited pool of threads. Most of a request's time is spent **waiting**: for the database, for another API, for a file.

```sql
Synchronous request (blocking):
Thread 7: [work][──────── waiting for SQL Server, doing NOTHING ────────][work]
          → the thread is stuck for the whole request

Asynchronous request:
Thread 7: [work] → returns to the pool, serves other requests...
                                         SQL answers → Thread 3: [work]
          → no thread is blocked while waiting
```

```csharp
// Blocking: the thread waits for the query
public Order GetOrder(int id) => _db.Orders.Find(id);

// Async: the thread is released while the query runs
public async Task<Order?> GetOrderAsync(int id) => await _db.Orders.FindAsync(id);
```

For **one** request, async is not faster — the query takes the same time. The gain is **scalability**: with blocking code, 100 slow requests use 100 threads; with async, a handful of threads serve all of them.

> **async is about waiting efficiently, not about running in parallel. It shines with I/O (database, HTTP, files), and does nothing for CPU work.**

---

## Task, and what await really does

A `Task` (or `Task<T>`) represents an operation that will complete later — like a promise in JavaScript.

```csharp
public async Task<decimal> GetCustomerTotalAsync(int customerId)
{
    var orders = await _repo.GetOrdersAsync(customerId);   // 1
    return orders.Sum(o => o.Total);                       // 2
}
```

The compiler turns this method into a small **state machine**. Simplified:

```sql
Call GetCustomerTotalAsync
 → run until the first await
 → GetOrdersAsync not finished? Return an unfinished Task to the caller, free the thread
 → ... the database answers ...
 → a thread pool thread resumes the method after the await (step 2)
 → the Task completes with the result
```

Code **before** the first `await` runs synchronously on the caller's thread. Code **after** it may run on another thread. `async` without any `await` runs completely synchronously (and the compiler warns you).

---

## Mistake 1: sync over async (.Result, .Wait())

Calling `.Result` or `.Wait()` on a task **blocks** the thread until the task completes:

```csharp
public IActionResult Get(int id)
{
    var order = _service.GetOrderAsync(id).Result;   // ❌ blocks a thread while waiting
    return Ok(order);
}
```

Two problems:

**Deadlocks** in apps with a synchronization context (WinForms, WPF, old ASP.NET on .NET Framework):

```sql
UI thread: calls .Result → blocked, waiting for the task
Task:      finished the I/O, wants to continue ON THE UI THREAD (captured context)
           → but the UI thread is blocked waiting for the task
           → both wait for each other forever 🔒
```

**Thread pool starvation** in ASP.NET Core (no deadlock, but worse under load): every blocked request holds a thread doing nothing. When the pool runs out, new requests queue, the pool grows slowly (a few threads per second), and response times explode while the CPU is almost idle.

The fix is always the same: **async all the way up**.

```csharp
public async Task<IActionResult> Get(int id)
{
    var order = await _service.GetOrderAsync(id);
    return Ok(order);
}
```

If you're in a `Main` method or a test: `static async Task Main()` and `async Task` test methods are supported — you don't need `.Result` there either.

---

## Mistake 2: async void

```csharp
public async void SendWelcomeEmail(User user)    // ❌
{
    await _mailer.SendAsync(user.Email, "Welcome!");
}
```

An `async void` method can't be awaited, so the caller doesn't know when it finishes — and an **exception inside it crashes the process** (it can't be caught by the caller). In ASP.NET Core, the request may also end before the method runs, with its scoped services already disposed.

```csharp
public async Task SendWelcomeEmailAsync(User user)   // ✅ return a Task
{
    await _mailer.SendAsync(user.Email, "Welcome!");
}
```

The only valid use of `async void` is **event handlers** (`button_Click`), because their signature requires `void`.

---

## ConfigureAwait(false): when it matters

By default, `await` captures the current **synchronization context** and resumes on it (the UI thread in desktop apps). `ConfigureAwait(false)` says "resume on any thread":

```csharp
var data = await stream.ReadAsync(buffer).ConfigureAwait(false);
```

| Where | Use `ConfigureAwait(false)`? |
|---|---|
| **ASP.NET Core** app code | Not needed — there's no synchronization context |
| **Libraries** (NuGet packages, shared class libraries) | ✅ Yes — the library may be used from a UI app or old ASP.NET |
| **UI apps** (WPF, WinForms) — code that updates controls after `await` | ❌ No — you need to come back to the UI thread |

In an ASP.NET Core project, you can leave it out of your application code. In a shared library used by a desktop app, add it to every `await`.

---

## Mistake 3: awaiting one by one when you could run in parallel

```csharp
// ❌ Sequential: 300 + 300 + 300 ms
var customer = await _customers.GetAsync(id);
var orders = await _orders.GetForCustomerAsync(id);
var invoices = await _invoices.GetForCustomerAsync(id);
```

These calls are independent — start them all, then wait for all of them:

```csharp
// ✅ Parallel: ~300 ms
var customerTask = _customers.GetAsync(id);
var ordersTask = _orders.GetForCustomerAsync(id);
var invoicesTask = _invoices.GetForCustomerAsync(id);

await Task.WhenAll(customerTask, ordersTask, invoicesTask);

var customer = customerTask.Result;     // safe here: the tasks are already completed
var orders = ordersTask.Result;
var invoices = invoicesTask.Result;
```

⚠️ Not with the **same `DbContext`**: EF Core doesn't support two queries at the same time on one context ("A second operation was started on this context"). Parallelize calls to **different** services or HTTP APIs, or use separate contexts.

For many items with a limit, .NET 6 added `Parallel.ForEachAsync`:

```csharp
await Parallel.ForEachAsync(customerIds, new ParallelOptions { MaxDegreeOfParallelism = 5 },
    async (id, ct) => await _sync.SyncCustomerAsync(id, ct));
```

---

## CancellationToken: pass it everywhere

When the user closes the page, the request is aborted — but your code keeps querying the database unless you pass the cancellation along:

```csharp
[HttpGet("report")]
public async Task<IActionResult> Report(CancellationToken cancellationToken)   // bound to HttpContext.RequestAborted
{
    var rows = await _reports.BuildAsync(cancellationToken);
    return Ok(rows);
}

public async Task<List<ReportRow>> BuildAsync(CancellationToken ct)
{
    var data = await _db.Sales.Where(...).ToListAsync(ct);          // EF Core stops the query
    var rates = await _http.GetFromJsonAsync<Rates>("/rates", ct);  // HttpClient cancels the call
    return Compute(data, rates);
}
```

Rule: if a method is async and calls other async methods, give it a `CancellationToken ct = default` parameter and pass it down. For timeouts on a task that doesn't support cancellation, .NET 6 added `task.WaitAsync(TimeSpan)`.

---

## Task.Run: for CPU work, not to "make things async"

```csharp
// ❌ Fake async in ASP.NET Core: takes a thread from the pool to block another one
public Task<Order> GetOrderAsync(int id) => Task.Run(() => _db.Orders.Find(id));
```

That frees nothing — the work still blocks a thread pool thread, plus the cost of switching. Use the **real async API** (`FindAsync`).

`Task.Run` is useful for **CPU-bound** work in **UI apps** (keep the UI thread responsive while computing), or to start independent background work. In ASP.NET Core request code, there's almost never a reason to use it.

---

## ValueTask: when (and when not)

`ValueTask<T>` avoids allocating a `Task` when the result is **often already available**:

```csharp
private readonly ConcurrentDictionary<int, Product> _cache = new();

public ValueTask<Product> GetProductAsync(int id)
{
    if (_cache.TryGetValue(id, out var product))
        return ValueTask.FromResult(product);                // no allocation: synchronous fast path

    return new ValueTask<Product>(LoadAndCacheAsync(id));   // the rare slow path
}
```

Use it only for hot paths with a frequent synchronous result (caches, buffered readers). And respect its rules: **await it once**, never twice, never store it to await later, never call `.Result` before it completes. For normal application code, `Task` is simpler and safe.

---

## IAsyncEnumerable: streaming results

When results arrive one by one (a big query, a paged API), `IAsyncEnumerable<T>` lets you process each item as it comes:

```csharp
public async IAsyncEnumerable<Order> StreamOrdersAsync([EnumeratorCancellation] CancellationToken ct = default)
{
    await foreach (var order in _db.Orders.AsNoTracking().AsAsyncEnumerable().WithCancellation(ct))
        yield return order;
}

await foreach (var order in StreamOrdersAsync(ct))
    await exporter.WriteAsync(order);       // no need to load 1 million orders in memory first
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| async frees the thread while waiting; it doesn't create threads | Scalability for I/O, nothing for CPU work |
| Async all the way up — never `.Result` / `.Wait()` | Deadlocks (UI, old ASP.NET) and thread pool starvation |
| Return `Task`, never `async void` (except event handlers) | Exceptions crash the process, callers can't await |
| `ConfigureAwait(false)` in libraries, not needed in ASP.NET Core apps | No sync context in ASP.NET Core |
| Independent calls → `Task.WhenAll` | 300 ms instead of 900 ms |
| Never parallel queries on the same `DbContext` | It's not thread-safe |
| Pass `CancellationToken` everywhere | Aborted requests stop their work |
| No `Task.Run` to fake async in web code | It blocks a thread anyway |
| `ValueTask` only for hot paths with frequent sync results | And await it exactly once |
| `IAsyncEnumerable` + `await foreach` for streaming | Process items as they arrive |

>
> ## That's it & see you soon!.
>
