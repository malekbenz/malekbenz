---
layout: post
title: "Health checks in ASP.NET Core - Liveness, readiness and dependency checks"
date: 2024-07-10
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: 'Health checks in ASP.NET Core - Liveness, readiness and dependency checks'
image: /images/covers/aspnet-core-health-checks.png
---

The process is running. The load balancer pings the server, gets an answer, and keeps sending traffic. And every single request fails — because the API can't reach SQL Server since a firewall change an hour ago. Nobody was alerted, because from the outside, "the app is up". A **health check** answers a better question than "is the process alive?": **can this instance actually do its job?** ASP.NET Core has it built in. Let's set it up properly: liveness vs readiness, checks for SQL Server, Redis and other APIs, a custom check, and what you should (and shouldn't) expose.

## The core idea: "is it running?" vs "can it work?"

```sql
GET /health/live    → "Is the process alive and not stuck?"         → if NO: restart it
GET /health/ready   → "Can it serve requests? (DB, cache, APIs OK)" → if NO: stop sending traffic, but DON'T restart
```

| Endpoint | Checks | Who calls it | On failure |
|---|---|---|---|
| **Liveness** | Only the app itself (no dependencies) | Process manager, orchestrator | Restart the instance |
| **Readiness** | The dependencies needed to serve requests | Load balancer, deployment pipeline | Take it out of rotation until it recovers |

Why two? If SQL Server is down, restarting all your API instances doesn't fix SQL Server — it just adds restart storms. The instance should stay alive (liveness OK) but stop receiving traffic (readiness failing) until the database is back.

> **Liveness: never depends on anything external. Readiness: checks exactly what the app needs to work.**

---

## The basics

```csharp
builder.Services.AddHealthChecks();

var app = builder.Build();
app.MapHealthChecks("/health");
```

```sql
GET /health → 200 "Healthy"
```

With no checks registered, this only proves the app answers HTTP — that's already a liveness endpoint. Status codes by default:

| Result | HTTP status |
|---|---|
| `Healthy` | 200 |
| `Degraded` | 200 (still working, but something isn't right) |
| `Unhealthy` | **503** |

Load balancers and monitoring tools only need the status code.

---

## Liveness and readiness with tags

Register checks with **tags**, and map one endpoint per purpose with a **predicate**:

```sql
dotnet add package AspNetCore.HealthChecks.SqlServer
dotnet add package AspNetCore.HealthChecks.Redis
dotnet add package AspNetCore.HealthChecks.Uris
dotnet add package AspNetCore.HealthChecks.UI.Client
```

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: new[] { "live" })
    .AddSqlServer(
        builder.Configuration.GetConnectionString("Shop")!,
        name: "sql-server",
        timeout: TimeSpan.FromSeconds(3),
        tags: new[] { "ready" })
    .AddRedis(
        builder.Configuration.GetConnectionString("Redis")!,
        name: "redis",
        failureStatus: HealthStatus.Degraded,          // cache down = degraded, not unhealthy
        tags: new[] { "ready" })
    .AddUrlGroup(
        new Uri("https://rates.example.com/health"),
        name: "rates-api",
        failureStatus: HealthStatus.Degraded,
        tags: new[] { "ready" });
```

```csharp
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live"),
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse,   // detailed JSON
});
```

The `AspNetCore.HealthChecks.*` packages (community-maintained, very widely used) provide ready-made checks for SQL Server, Redis, RabbitMQ, Elasticsearch, URLs, disk space and dozens more.

---

## Degraded vs Unhealthy

Not every dependency is equally important. Decide per check with `failureStatus`:

| Dependency down | Can the app still serve requests? | Status |
|---|---|---|
| SQL Server (the main database) | ❌ No | `Unhealthy` → 503, out of rotation |
| Redis (a cache) | ✅ Yes, slower (falls back to the DB) | `Degraded` → 200, but visible in monitoring |
| An optional partner API (exchange rates) | ✅ Mostly | `Degraded` |

Marking a cache as `Unhealthy` would take **all** your instances out of rotation when Redis restarts — turning a small slowdown into a full outage. Readiness should fail only for what the app **can't** work without.

---

## A custom health check

Some things only your app knows. Example: a background service that imports orders every 5 minutes — if it hasn't run for 30 minutes, something is wrong, even if the process is fine.

```csharp
public sealed class ImportHeartbeat
{
    private long _lastRunTicks = DateTime.UtcNow.Ticks;
    public void Beat() => Interlocked.Exchange(ref _lastRunTicks, DateTime.UtcNow.Ticks);
    public DateTime LastRun => new(Interlocked.Read(ref _lastRunTicks), DateTimeKind.Utc);
}

public sealed class ImportJobHealthCheck(ImportHeartbeat heartbeat) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var age = DateTime.UtcNow - heartbeat.LastRun;
        var data = new Dictionary<string, object> { ["lastRun"] = heartbeat.LastRun, ["ageMinutes"] = (int)age.TotalMinutes };

        var result = age switch
        {
            _ when age < TimeSpan.FromMinutes(10) => HealthCheckResult.Healthy("Import running", data),
            _ when age < TimeSpan.FromMinutes(30) => HealthCheckResult.Degraded("Import is late", data: data),
            _ => HealthCheckResult.Unhealthy("Import has not run for 30 minutes", data: data),
        };
        return Task.FromResult(result);
    }
}
```

```csharp
builder.Services.AddSingleton<ImportHeartbeat>();
builder.Services.AddHealthChecks()
    .AddCheck<ImportJobHealthCheck>("import-job", tags: new[] { "ready" });

// In the BackgroundService, after each successful run:
_heartbeat.Beat();
```

Other good custom checks: free disk space on the upload folder, the length of a work queue, the age of the last message processed, a license or certificate about to expire.

---

## Rich JSON output

With `UIResponseWriter.WriteHealthCheckUIResponse`, the readiness endpoint returns details for each check:

```json
{
  "status": "Degraded",
  "totalDuration": "00:00:00.0712345",
  "entries": {
    "sql-server": { "status": "Healthy", "duration": "00:00:00.0123456", "tags": ["ready"] },
    "redis":      { "status": "Degraded", "description": "It was not possible to connect to the redis server(s)", "tags": ["ready"] },
    "rates-api":  { "status": "Healthy", "duration": "00:00:00.0587000", "tags": ["ready"] },
    "import-job": { "status": "Healthy", "data": { "lastRun": "2024-07-10T09:55:00Z", "ageMinutes": 3 } }
  }
}
```

The same package family offers a **HealthChecks UI** dashboard (`AspNetCore.HealthChecks.UI` + a storage provider) that polls several apps' endpoints and shows their history — handy for an internal operations page.

---

## Timeouts, caching and not overloading your dependencies

A load balancer may call `/health/ready` every few seconds, from several places. Each call runs **every** check: a SQL query, a Redis ping, an HTTP call.

- **Set timeouts** on checks (`timeout: TimeSpan.FromSeconds(3)`): a hanging dependency must make the check fail quickly, not hang the health endpoint.
- **Keep checks cheap**: `SELECT 1`, a Redis `PING` — not a business query.
- **Cache the result** for a few seconds if the endpoint is called very often (with output caching from .NET 7):

```csharp
builder.Services.AddOutputCache();
app.UseOutputCache();

app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") })
   .CacheOutput(p => p.Expire(TimeSpan.FromSeconds(10)));
```

- **Don't put readiness checks on liveness**: a slow database would make the orchestrator restart healthy processes.

---

## Security: what to expose

The detailed JSON reveals which databases, caches and partners you use, their names and response times. That's useful for you — and for an attacker.

```csharp
// Public, minimal: status code + "Healthy"/"Unhealthy" only
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = c => c.Tags.Contains("live") });

// Detailed: only on an internal port, or for authenticated operators
app.MapHealthChecks("/health/ready", new HealthCheckOptions
    {
        Predicate = c => c.Tags.Contains("ready"),
        ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse,
    })
   .RequireHost("*:8081");                  // reachable only on the internal management port
   // or .RequireAuthorization("Operators")
```

And make sure exception messages from failing checks (connection strings in error texts!) never reach public endpoints.

---

## Background workers and Windows services

A worker service (a `BackgroundService` hosted as a Windows service) has no HTTP endpoint by default — so nothing can check it. Two options:

- Make it a **web host** too (`WebApplication` with Kestrel on an internal port) and map `/health` — the same code as above, plus the heartbeat check for its jobs.
- Or have the worker **push** its status: an `IHealthCheckPublisher` runs the checks periodically and can send the results to your monitoring system or write them to a file/table that monitoring reads.

---

## Key rules to remember

| Rule | Why |
|---|---|
| "Process is up" ≠ "the app works" | Dependency failures are invisible without checks |
| Liveness: no external dependencies | Otherwise a DB outage restarts every instance |
| Readiness: what the app needs to serve requests | Out of rotation while broken, no restart |
| Tags + predicates for separate endpoints | One registration list, several endpoints |
| `Unhealthy` only for critical dependencies, `Degraded` for the rest | A cache restart shouldn't cause an outage |
| Custom checks for app-specific health (jobs, queues, disk) | Things only your app knows |
| Timeouts and cheap checks; cache results if polled often | Health checks must not overload dependencies |
| Detailed output only internally or authenticated | It reveals your infrastructure |
| Give workers a way to report health (endpoint or publisher) | Silent workers fail silently |

>
> ## That's it & see you soon!.
>
