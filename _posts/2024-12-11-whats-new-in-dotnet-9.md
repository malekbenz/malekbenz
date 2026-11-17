---
layout: post
title: "What's new in .NET 9 - Built-in OpenAPI, HybridCache, C# 13 and more"
date: 2024-12-11
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'Asp.Net']
categories: ['.Net', 'Asp.Net']
description: 'What is new in .NET 9 - Built-in OpenAPI, HybridCache, C# 13 and more'
image: /images/covers/whats-new-in-dotnet-9.png
---

.NET 9 shipped on November 12, 2024. Like every November, the announcement is long; and like every year, a dozen changes will matter in your day-to-day code. Two years ago I picked the [useful parts of .NET 7](/blog/2022/12/14/whats-new-in-dotnet-7-csharp-11); this post does the same for .NET 9, with a short example for each — from the OpenAPI change you'll notice in your first new project, to the LINQ methods you'll wonder how you lived without.

## .NET 9 or stay on .NET 8?

| Version | Type | Support ends |
|---|---|---|
| .NET 8 | **LTS** (3 years) | November 2026 |
| .NET 9 | **STS** (18 months) | May 2026 |

Same reasoning as with .NET 7: .NET 8 is supported **longer** than .NET 9. Teams that upgrade once every few years stay on 8 and jump to .NET 10 (the next LTS, planned for November 2025). Teams that deploy often can move to 9 for the features — and the performance gains, which are again significant.

> **C# 13 and the new APIs need `net9.0`. The runtime performance improvements come for free when you retarget.**

---

## ASP.NET Core 9

### Built-in OpenAPI — Swashbuckle leaves the templates

The most visible change: new Web API projects **no longer include Swashbuckle**. ASP.NET Core 9 generates OpenAPI documents itself:

```csharp
builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Environment.IsDevelopment())
    app.MapOpenApi();                     // serves /openapi/v1.json
```

It's built into the framework, works with controllers and minimal APIs (including `TypedResults` and `Results<...>`), and supports **build-time** generation. What it doesn't include is a UI: the template no longer has the Swagger UI page. You can add one (Swagger UI or Scalar, both available as packages pointing at `/openapi/v1.json`), or use the `.http` files in Visual Studio / VS Code.

Existing projects with Swashbuckle keep working — no need to migrate right away.

### HybridCache (preview)

In the [caching post](/blog/2022/05/11/aspnet-core-caching-memory-redis) we had to choose between `IMemoryCache` (fast, per server) and `IDistributedCache` (shared, with manual serialization), and protect against stampedes ourselves with a `SemaphoreSlim`. **HybridCache** does all of that in one API:

```sql
dotnet add package Microsoft.Extensions.Caching.Hybrid --prerelease
```

```csharp
builder.Services.AddHybridCache();      // uses IDistributedCache (e.g. Redis) as the second level if registered

public class CategoryService(HybridCache cache, ICategoryRepository repo)
{
    public Task<List<Category>> GetAllAsync(CancellationToken ct = default) =>
        cache.GetOrCreateAsync(
            "categories:all",
            async token => await repo.GetAllAsync(token),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(30) },
            tags: new[] { "categories" },
            cancellationToken: ct).AsTask();
}

// After a change:
await cache.RemoveByTagAsync("categories");
```

- **Two levels**: in-memory first, then the distributed cache, then your factory.
- **Stampede protection built in**: 100 concurrent misses for the same key → **one** factory call.
- **Serialization handled** for you, and **tags** to invalidate groups of entries.

At the .NET 9 release, the package is still in **preview** — try it now, plan production use when it's stable.

### MapStaticAssets

```csharp
app.MapStaticAssets();       // instead of app.UseStaticFiles() for your app's own files
```

It knows your static files at **build time**: it compresses them (gzip/Brotli) during publish, adds fingerprinted URLs and strong caching headers — the "hashed assets cached forever, index.html never" rule from the [React + ASP.NET Core post](/blog/2024/01/24/react-aspnet-core-vite-to-production), done by the framework for files it builds. `UseStaticFiles` remains for files that change at runtime.

### Smaller ones

```csharp
return TypedResults.InternalServerError("Something went wrong");    // new in .NET 9
```

Plus: SignalR hub methods accept **polymorphic** parameters, better trimming and Native AOT support across ASP.NET Core, and improved developer exception page details.

---

## C# 13

### params collections

`params` used to accept only arrays. Now it works with any collection type — including spans, which avoids allocations:

```csharp
public static decimal Sum(params ReadOnlySpan<decimal> values)
{
    var total = 0m;
    foreach (var v in values) total += v;
    return total;
}

Sum(10m, 20m, 5.5m);          // no array allocated
```

### A real Lock type

```csharp
private readonly Lock _gate = new();      // System.Threading.Lock

public void Add(Order order)
{
    lock (_gate)                          // the compiler uses Lock's faster, dedicated API
    {
        _orders.Add(order);
    }
}
```

`lock` on a `Lock` object is clearer than locking on `object` and is optimized by the runtime.

### Partial properties, ref structs in async, \e

```csharp
public partial class Settings
{
    public partial string Theme { get; set; }        // declared here, implemented by a source generator
}

async Task ProcessAsync()
{
    ReadOnlySpan<char> name = GetName();            // ✅ allowed in async methods now...
    Console.WriteLine(name.Length);                  // ...as long as it's not used across an await
    await SaveAsync();
}

Console.WriteLine("\e[1mBold in the terminal\e[0m");   // \e = the ESC character
```

---

## Libraries

### LINQ: CountBy, AggregateBy, Index

```csharp
// Count per key — no GroupBy, no intermediate groups
var ordersPerStatus = orders.CountBy(o => o.Status);
// [("Paid", 12), ("New", 3), ("Shipped", 7)]

// Aggregate per key
var revenuePerCustomer = orders.AggregateBy(o => o.CustomerId, seed: 0m, (sum, o) => sum + o.Total);

// Index and value together, no Select((x, i) => ...)
foreach (var (index, order) in orders.Index())
    Console.WriteLine($"{index + 1}. {order.Id}");
```

### Task.WhenEach

Process tasks **as they complete**, instead of waiting for all of them:

```csharp
var tasks = customerIds.Select(id => LoadReportAsync(id));

await foreach (var finished in Task.WhenEach(tasks))
{
    var report = await finished;
    await ShowAsync(report);              // the fastest reports appear first
}
```

### Guid version 7 and Base64Url

```csharp
var id = Guid.CreateVersion7();          // time-ordered GUIDs: much better as database keys than random ones
```

Random GUIDs (v4) as clustered keys fragment indexes, because each new row lands at a random place in the B-tree. Version 7 GUIDs start with a timestamp, so new rows go at the end.

`Base64Url` (in `System.Buffers.Text`) encodes URL-safe base64 — the format of JWT parts and many tokens — without the `+`, `/`, `=` replace dance.

---

## EF Core 9

```csharp
options.UseSqlServer(connectionString)
       .UseSeeding((context, _) =>
       {
           if (!context.Set<OrderStatus>().Any())
           {
               context.Set<OrderStatus>().AddRange(new OrderStatus { Id = 1, Name = "New" }, new OrderStatus { Id = 2, Name = "Paid" });
               context.SaveChanges();
           }
       })
       .UseAsyncSeeding(async (context, _, ct) => { /* same, async */ });
```

- **`UseSeeding` / `UseAsyncSeeding`**: one official place for seed data, run by `EnsureCreated` and `Migrate`.
- **Pending model changes are now an error**: `Migrate()` throws if the model has changes without a migration — no more forgetting `dotnet ef migrations add`.
- Better LINQ translation (more queries become SQL instead of failing), and **auto-compiled models** for faster startup with large models.

---

## Runtime and upgrade notes

The runtime keeps getting faster: JIT improvements (loops, bounds checks, more devirtualization), faster `System.Text.Json`, LINQ and collections, less memory with the new **dynamic GC adaptation** (DATAS) on by default for server GC. Most apps see gains just by retargeting.

Things to check when upgrading:

```sql
1. <TargetFramework>net9.0</TargetFramework>, update Microsoft.* packages to 9.0.x
2. BinaryFormatter is REMOVED (it was obsolete) — replace any remaining use
3. New Web API templates use AddOpenApi; your existing Swashbuckle setup still works
4. EF Core 9: run Migrate in a test environment — pending model changes now throw
5. Run the tests, compare memory and response times
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| .NET 9 is STS (until May 2026), .NET 8 is LTS (until Nov 2026) | Choose by how often you upgrade |
| `AddOpenApi` + `MapOpenApi` — add a UI yourself if you want one | Swashbuckle is gone from templates |
| HybridCache: two levels, stampede protection, tags (preview at launch) | One API instead of memory + distributed + locks |
| `MapStaticAssets` for build-time static files | Compression and fingerprinted caching for free |
| `params ReadOnlySpan<T>` | Variadic methods without allocations |
| `System.Threading.Lock` with `lock` | Clearer and faster locking |
| `CountBy`, `AggregateBy`, `Index` | Shorter LINQ for common reports |
| `Task.WhenEach` | Handle results as soon as they arrive |
| `Guid.CreateVersion7()` for database keys | Ordered inserts, less index fragmentation |
| EF Core 9: `UseSeeding`, pending changes throw | Clean seeding, no forgotten migrations |

>
> ## That's it & see you soon!.
>
