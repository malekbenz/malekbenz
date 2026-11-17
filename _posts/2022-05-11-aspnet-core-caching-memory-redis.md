---
layout: post
title: "Caching in ASP.NET Core - IMemoryCache, Redis and the hard parts"
date: 2022-05-11
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#', 'Redis']
categories: ['Asp.Net', '.Net']
description: 'Caching in ASP.NET Core - IMemoryCache, Redis and the hard parts'
image: /images/covers/aspnet-core-caching-memory-redis.png
---

The product categories page queries SQL Server 2,000 times a minute — for a list that changes once a week. The dashboard recomputes the same statistics for every user who opens it. Caching fixes this in a few lines... and then brings its own problems: users see old prices, 100 requests rebuild the same cache entry at the same moment, the second server has different data than the first. There are only two hard things in computer science, as the saying goes, and cache invalidation is one of them. Let's do the easy part right (`IMemoryCache`, Redis), then tackle the hard parts.

## The core idea: cache-aside

The pattern used 90% of the time:

```sql
Request → is it in the cache?
            ├─ yes → return it                              (fast: microseconds)
            └─ no  → load from the database → store in cache → return it   (slow: once)
```

The application code checks the cache, loads on a miss, and stores the result. The database stays the source of truth; the cache is a **copy** that can disappear at any time.

> **A cache is a trade-off: speed in exchange for data that may be a little old. Always decide HOW old is acceptable for each piece of data.**

---

## IMemoryCache

The cache lives in the **memory of the app process**: the fastest option, built into ASP.NET Core.

```csharp
builder.Services.AddMemoryCache();
```

```csharp
public class CategoryService
{
    private readonly IMemoryCache _cache;
    private readonly ICategoryRepository _repo;

    public CategoryService(IMemoryCache cache, ICategoryRepository repo)
    {
        _cache = cache;
        _repo = repo;
    }

    public async Task<IReadOnlyList<Category>> GetAllAsync()
    {
        var categories = await _cache.GetOrCreateAsync("categories:all", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30);
            return _repo.GetAllAsync();
        });
        return categories!;
    }
}
```

From 2,000 queries a minute to **one** every 30 minutes.

### Absolute vs sliding expiration

```csharp
entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30);   // removed 30 min after creation, always
entry.SlidingExpiration = TimeSpan.FromMinutes(5);                  // removed after 5 min WITHOUT access
```

| Expiration | Removed when | Good for | Risk |
|---|---|---|---|
| Absolute | A fixed time after creation | Data that changes (prices, stock, lists) | — |
| Sliding | Nobody read it for a while | Expensive data used in bursts (a report a user is browsing) | A popular entry **never** expires → stale forever |
| Both | Whichever comes first | Sliding with a safety limit | — |

Never use sliding expiration alone for data that can change: an entry read every minute never expires.

### Limit the memory

The memory cache has **no size limit by default** — cache too much and the app's memory grows until it's recycled. Set a limit:

```csharp
builder.Services.AddMemoryCache(options => options.SizeLimit = 10_000);   // in your own units
```

With a `SizeLimit`, every entry **must** declare its size (`entry.Size = 1;` or an estimate), otherwise adding it throws. When the limit is reached, the cache evicts entries (lowest priority and oldest first).

---

## When memory cache isn't enough

`IMemoryCache` is **per process**. With two servers behind a load balancer:

```sql
Server A: cache says price = 10 €      Server B: cache says price = 12 €
User refreshes → sometimes 10, sometimes 12
```

Also, every deployment or restart **empties** it, and every server loads the same data from the database. When you have several instances, or the data is expensive to rebuild, use a **distributed cache**: one shared cache for all servers — usually **Redis**.

---

## IDistributedCache with Redis

```sql
dotnet add package Microsoft.Extensions.Caching.StackExchangeRedis
```

```csharp
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration.GetConnectionString("Redis");   // "localhost:6379"
    options.InstanceName = "shop:";                                               // prefix for all keys
});
```

`IDistributedCache` stores **bytes** (or strings) — you serialize yourself:

```csharp
public class CategoryService
{
    private static readonly DistributedCacheEntryOptions CacheOptions = new()
    {
        AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30)
    };

    private readonly IDistributedCache _cache;
    private readonly ICategoryRepository _repo;

    public CategoryService(IDistributedCache cache, ICategoryRepository repo)
    {
        _cache = cache;
        _repo = repo;
    }

    public async Task<IReadOnlyList<Category>> GetAllAsync(CancellationToken ct = default)
    {
        const string key = "categories:all";

        var cached = await _cache.GetStringAsync(key, ct);
        if (cached is not null)
            return JsonSerializer.Deserialize<List<Category>>(cached)!;

        var categories = await _repo.GetAllAsync(ct);
        await _cache.SetStringAsync(key, JsonSerializer.Serialize(categories), CacheOptions, ct);
        return categories;
    }
}
```

The code is the same pattern; only the storage changed. A few practical points:

- **Keys**: use a clear convention — `area:entity:id` (`products:42`, `categories:all`). The `InstanceName` prefix separates apps sharing one Redis.
- **Serialization**: every read deserializes. Cache **small DTOs**, not entire EF entities with navigation properties.
- **Redis can be down**: decide what happens. Usually: log, and fall back to the database instead of failing the request.

### Memory or Redis?

| | `IMemoryCache` | Redis (`IDistributedCache`) |
|---|---|---|
| Speed | Fastest (no network, no serialization) | Fast (~1 ms on the network) |
| Shared between servers | ❌ | ✅ |
| Survives restarts/deployments | ❌ | ✅ |
| Stores | Any object | Bytes / strings (you serialize) |
| Extra infrastructure | None | A Redis server |
| Good for | One instance, small reference data | Several instances, expensive data, sessions |

Many apps use **both**: a short memory cache (seconds) in front of Redis (minutes) for the hottest keys.

---

## The hard part 1: cache stampede

The cache entry for the dashboard statistics expires. The query takes 3 seconds. In those 3 seconds, 100 requests arrive — they all see a miss, and they **all** run the 3-second query:

```sql
10:00:00.000  entry expires
10:00:00.010  request 1: miss → starts the query
10:00:00.020  request 2: miss → starts the query
...           request 100: miss → starts the query   → 100 heavy queries at once 💥
```

`GetOrCreateAsync` doesn't protect you: its factory isn't locked. The simplest fix in one process: let **one** caller rebuild while the others wait:

```csharp
private static readonly SemaphoreSlim RebuildLock = new(1, 1);

public async Task<Stats> GetStatsAsync(CancellationToken ct)
{
    if (_cache.TryGetValue("stats", out Stats? stats))
        return stats!;

    await RebuildLock.WaitAsync(ct);
    try
    {
        if (_cache.TryGetValue("stats", out stats))      // another request may have rebuilt it meanwhile
            return stats!;

        stats = await _repo.ComputeStatsAsync(ct);
        _cache.Set("stats", stats, TimeSpan.FromMinutes(5));
        return stats;
    }
    finally
    {
        RebuildLock.Release();
    }
}
```

Two other useful tricks:

- **Jitter**: add a random few seconds to expirations (`TimeSpan.FromMinutes(30) + TimeSpan.FromSeconds(Random.Shared.Next(0, 60))`) so thousands of entries created at the same moment don't all expire at the same moment.
- **Refresh in the background**: for critical data, a background service rebuilds the entry **before** it expires, so users never see a miss.

---

## The hard part 2: invalidation

When data changes, the cache must not keep serving the old version for 30 minutes. Three strategies:

| Strategy | How | Trade-off |
|---|---|---|
| Short expiration | Accept up to N minutes of staleness | Simplest, slightly stale data |
| Remove on write | After `UpdateProduct`, `cache.Remove("products:42")` | Fresh, but every write path must remember it |
| Versioned keys | Key includes a version: `products:v7:42`; bump the version to invalidate everything | Invalidates groups at once; old keys expire on their own |

```csharp
public async Task UpdatePriceAsync(int productId, decimal price, CancellationToken ct)
{
    await _repo.UpdatePriceAsync(productId, price, ct);
    await _cache.RemoveAsync($"products:{productId}", ct);     // the next read reloads it
}
```

Remove **after** the database write succeeds — never before (another request could re-cache the old value in between). And with several servers using `IMemoryCache`, removing on one server doesn't remove on the others: that's one more reason for Redis, or for short expirations.

---

## Caching per user: key design and security

```csharp
// ❌ The same key for everybody → user B sees user A's orders
var key = "orders:recent";

// ✅ The user is part of the key
var key = $"orders:recent:user:{userId}";
```

Anything that depends on the user, their permissions, their language or their tenant **must** be in the key. A cache bug here is a **data leak**, not just a display bug. When in doubt, don't cache per-user data at all — cache the shared parts (product lists, categories, settings), and query the personal parts.

---

## What NOT to cache

```sql
❌ Data that must be exact right now: account balances, stock at checkout, permissions just revoked
❌ Data that's cheap to load anyway (a primary key lookup on an indexed table)
❌ Huge objects (big lists, entities with all their relations) — memory and serialization cost
❌ Anything you haven't measured: cache what's slow and frequent, not everything
```

Measure first: the query that runs 2,000 times a minute is the target; the one that runs twice a day is not.

---

## Response caching vs data caching

Everything above caches **data** inside your app. ASP.NET Core can also cache **whole HTTP responses** (`[ResponseCache]` attributes set `Cache-Control` headers for browsers and proxies, and the response caching middleware can serve them from the server). It's great for public, anonymous pages; for authenticated APIs, data caching gives you much more control.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Cache-aside: check, load on miss, store | The database stays the source of truth |
| Decide how stale each piece of data may be | That's your expiration |
| Prefer absolute expiration; never sliding alone for changing data | Popular entries would never refresh |
| Set a `SizeLimit` on `IMemoryCache` | No unbounded memory growth |
| Several servers → Redis (`IDistributedCache`) | One shared, consistent cache that survives restarts |
| Cache small DTOs, with clear keys (`area:entity:id`) | Less memory and serialization, easy invalidation |
| Protect expensive rebuilds from stampedes (lock, jitter) | One rebuild instead of a hundred |
| Remove keys after successful writes, or keep TTLs short | Users see changes |
| Per-user data → the user id in the key (or don't cache it) | A wrong key is a data leak |
| Fall back to the database if Redis is down | The cache is an optimization, not a dependency |

>
> ## That's it & see you soon!.
>
