---
layout: post
title: "Dependency injection lifetimes in .NET - Singleton, Scoped, Transient and the captive dependency"
date: 2022-02-09
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['.Net', 'Asp.Net']
description: 'Dependency injection lifetimes in .NET - Singleton, Scoped, Transient and the captive dependency'
image: /images/covers/dotnet-dependency-injection-lifetimes.png
---

`AddSingleton`, `AddScoped`, `AddTransient` — three lines that look interchangeable, and most of the time the app works with any of them. Until the day a user sees **another user's data**, a `DbContext` throws "A second operation was started on this context", or memory grows until the app restarts. Those bugs all come from the **lifetime** of a service. In the [.NET 6 minimal hosting post](/blog/2022/01/12/dotnet-6-minimal-hosting-startup-to-program) we registered services with `builder.Services`; today, let's see what each lifetime really means, with a demo you can run, and the classic bug that hides between them: the **captive dependency**.

## The core idea: who creates the object, and how long it lives

When you register a service, you tell the container two things: **which class** to create for an interface, and **how long** an instance lives.

```csharp
builder.Services.AddTransient<IPriceCalculator, PriceCalculator>();   // a new one every time
builder.Services.AddScoped<IOrderRepository, OrderRepository>();      // one per request
builder.Services.AddSingleton<IClock, SystemClock>();                 // one for the whole app
```

```sql
             App start ─────────────────────────────────────────────► App stop
Singleton    [══════════════════ one instance ═══════════════════════]

Request 1    [── scope ──]          Request 2    [── scope ──]
Scoped       [ instance A ]                      [ instance B ]

Transient    each injection → a new instance, even inside the same request
```

> **The lifetime is not a performance setting. It decides which code SHARES the same object — and sharing the wrong object is a bug.**

---

## A demo that shows the three lifetimes

```csharp
public interface IOperation { Guid Id { get; } }

public sealed class Operation : IOperation
{
    public Guid Id { get; } = Guid.NewGuid();
}

public interface ITransientOp : IOperation { }
public interface IScopedOp : IOperation { }
public interface ISingletonOp : IOperation { }

public sealed class TransientOp : Operation, ITransientOp { }
public sealed class ScopedOp : Operation, IScopedOp { }
public sealed class SingletonOp : Operation, ISingletonOp { }

// A service that also receives the three
public sealed class Reporter
{
    private readonly ITransientOp _t;
    private readonly IScopedOp _s;
    private readonly ISingletonOp _g;

    public Reporter(ITransientOp t, IScopedOp s, ISingletonOp g) => (_t, _s, _g) = (t, s, g);

    public object Ids => new { transient = _t.Id, scoped = _s.Id, singleton = _g.Id };
}
```

```csharp
builder.Services.AddTransient<ITransientOp, TransientOp>();
builder.Services.AddScoped<IScopedOp, ScopedOp>();
builder.Services.AddSingleton<ISingletonOp, SingletonOp>();
builder.Services.AddScoped<Reporter>();

app.MapGet("/ids", (ITransientOp t, IScopedOp s, ISingletonOp g, Reporter reporter) => new
{
    endpoint = new { transient = t.Id, scoped = s.Id, singleton = g.Id },
    reporter = reporter.Ids,
});
```

Call `/ids` twice and compare:

```sql
Request 1: endpoint  transient=1111  scoped=AAAA  singleton=ZZZZ
           reporter  transient=2222  scoped=AAAA  singleton=ZZZZ
Request 2: endpoint  transient=3333  scoped=BBBB  singleton=ZZZZ
           reporter  transient=4444  scoped=BBBB  singleton=ZZZZ
```

- **Transient**: different everywhere — even the endpoint and the reporter in the same request get different instances.
- **Scoped**: the same inside one request (`AAAA` twice), new for the next request (`BBBB`).
- **Singleton**: the same everywhere, forever (`ZZZZ`).

---

## Which lifetime for what?

| Lifetime | One instance per... | Use for | Examples |
|---|---|---|---|
| **Transient** | Injection | Lightweight, stateless services | Calculators, mappers, validators |
| **Scoped** | Request (scope) | Anything tied to the current request or unit of work | `DbContext`, repositories, current user info |
| **Singleton** | Application | Expensive to create, thread-safe, shared state | Configuration, caches, `HttpClient` handlers, clocks |

When unsure: **Scoped** is the safe default for application services in a web app. Use **Singleton** only for things that are thread-safe and hold no per-user data; use **Transient** for small stateless helpers.

`DbContext` deserves a special mention: `AddDbContext` registers it as **Scoped** on purpose. A `DbContext` is not thread-safe and tracks the entities of one unit of work — one per request is exactly right.

---

## What "scope" means

In ASP.NET Core, the framework creates a **scope** at the start of each HTTP request and disposes it at the end. Everything resolved from it — the controller, its dependencies, their dependencies — shares the same scoped instances.

```sql
HTTP request
  └─ scope created
       ├─ OrdersController        (transient)
       │    ├─ IOrderRepository   (scoped)  ─┐
       │    └─ IInvoiceService    (scoped)   │ both use the SAME ShopContext
       │         └─ ShopContext   (scoped)  ─┘
  └─ scope disposed → ShopContext.Dispose()
```

Outside of HTTP requests (console apps, background services, startup code) there's **no scope by default** — you create one yourself. We'll see why that matters in a minute.

---

## The captive dependency

The bug: a **singleton** that depends on a **scoped** service.

```csharp
builder.Services.AddScoped<ShopContext>();                     // one per request
builder.Services.AddSingleton<IProductCache, ProductCache>();  // one for the app

public sealed class ProductCache : IProductCache
{
    private readonly ShopContext _db;                          // ❌ a scoped service inside a singleton
    public ProductCache(ShopContext db) => _db = db;

    public Task<List<Product>> GetAllAsync() => _db.Products.ToListAsync();
}
```

The singleton is created **once**, so it receives **one** `ShopContext` — and keeps it forever. That context is now "captive":

```sql
Request 1 ─┐
Request 2 ─┼──► ProductCache (singleton) ──► THE SAME ShopContext, forever
Request 3 ─┘
```

Consequences:

- **Concurrency errors**: two requests use the same `DbContext` at the same time → `InvalidOperationException: A second operation was started on this context instance`.
- **Stale or leaked data**: the context tracks entities from all requests; changes made by one request are visible to others.
- **Memory growth**: the change tracker keeps growing for the life of the app.
- **Disposed objects**: if the scope that created it is disposed, the singleton keeps a dead object → `ObjectDisposedException`.

The same thing happens, more quietly, with a "current user" scoped service captured by a singleton: every request sees the **first** user. That's how a user ends up seeing someone else's data.

> **Rule: a service can only depend on services that live AS LONG or LONGER than itself.** Transient → anything; Scoped → Scoped or Singleton; Singleton → Singleton only.

### ValidateScopes and ValidateOnBuild catch it

In the **Development** environment, ASP.NET Core checks this for you and refuses to resolve the captive dependency:

```sql
System.InvalidOperationException: Cannot consume scoped service 'ShopContext'
from singleton 'IProductCache'.
```

That's a gift — don't disable it. You can also turn the checks on everywhere (they cost a bit at startup):

```csharp
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateScopes = true;      // detect scoped-in-singleton at resolution time
    options.ValidateOnBuild = true;     // check every registration when the app starts
});
```

`ValidateOnBuild` is the better one: it fails **at startup**, before any user sends a request.

### The fix: IServiceScopeFactory

When a singleton (or a background service — which is a singleton) really needs scoped services, it creates a **scope** for each unit of work:

```csharp
public sealed class ProductCache : IProductCache
{
    private readonly IServiceScopeFactory _scopeFactory;
    private List<Product>? _cache;

    public ProductCache(IServiceScopeFactory scopeFactory) => _scopeFactory = scopeFactory;

    public async Task<List<Product>> GetAllAsync()
    {
        if (_cache is not null) return _cache;

        await using var scope = _scopeFactory.CreateAsyncScope();     // a fresh scope...
        var db = scope.ServiceProvider.GetRequiredService<ShopContext>();
        _cache = await db.Products.AsNoTracking().ToListAsync();
        return _cache;
    }                                                                 // ...disposed here, with its DbContext
}
```

Same pattern in a `BackgroundService`: create a scope **per iteration** (or per message), never one for the whole service lifetime. (`CreateAsyncScope()` is new in .NET 6: it disposes `IAsyncDisposable` services correctly with `await using`.)

---

## Thread safety: singletons are shared by every request

A singleton is used by **all requests at the same time**, on different threads:

```csharp
public sealed class RequestCounter
{
    private int _count;
    public void Increment() => _count++;                          // ❌ not atomic: lost updates under load
    public void IncrementSafe() => Interlocked.Increment(ref _count); // ✅
}

public sealed class ProductCache
{
    private readonly Dictionary<int, Product> _items = new();     // ❌ corrupts under concurrent writes
    private readonly ConcurrentDictionary<int, Product> _safe = new(); // ✅
}
```

Rules for singletons: no per-user state, and every mutable field must be thread-safe (`ConcurrentDictionary`, `Interlocked`, locks, or immutable data). If you can't guarantee that, make it Scoped.

---

## Disposal: who disposes what

The container disposes the `IDisposable` / `IAsyncDisposable` objects **it created**, when their lifetime ends:

| Lifetime | Disposed when |
|---|---|
| Transient (resolved in a request) | The request scope ends |
| Scoped | The scope ends (end of request) |
| Singleton | The application stops |

Two traps:

- **Don't dispose injected services yourself** (`_db.Dispose()` in a repository): the container will dispose it again, and other services in the same scope still use it.
- **Transient disposables resolved from the root provider** (outside any scope, e.g. `app.Services.GetService<T>()` at startup) are kept until the app stops — a slow memory leak if done repeatedly. Resolve them from a scope.

---

## Registration tips

```csharp
// Several implementations: inject them all with IEnumerable<T>
builder.Services.AddScoped<INotifier, EmailNotifier>();
builder.Services.AddScoped<INotifier, SmsNotifier>();

public sealed class OrderService
{
    private readonly IEnumerable<INotifier> _notifiers;
    public OrderService(IEnumerable<INotifier> notifiers) => _notifiers = notifiers;   // all of them
}
// Injecting a single INotifier gives the LAST registration (SmsNotifier)

// TryAdd: register only if nothing is registered yet (great in libraries)
builder.Services.TryAddSingleton<IClock, SystemClock>();

// Factory: when construction needs logic or configuration
builder.Services.AddSingleton<IBlobStore>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    return new BlobStore(config.GetConnectionString("Blobs")!);
});
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| Lifetime = who shares the instance | Wrong sharing is a bug, not a performance issue |
| Transient: new every time; Scoped: one per request; Singleton: one per app | Verified with the instance-id demo |
| Scoped is the safe default for app services | Matches the request / unit of work |
| `DbContext` is Scoped — keep it that way | Not thread-safe, tracks one unit of work |
| Depend only on services that live as long or longer | Singleton → Scoped is a captive dependency |
| Keep `ValidateScopes` / `ValidateOnBuild` on | Captive dependencies fail at startup, not in production |
| Singletons and background services use `IServiceScopeFactory` | One scope per unit of work |
| Singletons must be thread-safe and user-free | Shared by every request at the same time |
| Never dispose injected services yourself | The container owns their lifetime |
| `IEnumerable<T>` for multiple implementations, `TryAdd` in libraries | Flexible, predictable registrations |

>
> ## That's it & see you soon!.
>
