---
layout: post
title: "Rate limiting in ASP.NET Core - Protect your API per user, per IP and per endpoint"
date: 2024-10-09
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#', 'Security']
categories: ['Asp.Net', '.Net']
description: 'Rate limiting in ASP.NET Core - Protect your API per user, per IP and per endpoint'
image: /images/covers/aspnet-core-rate-limiting.png
---

One partner's integration had a bug: a loop that called our export endpoint 40 times per second, for hours. Each call ran a heavy query. SQL Server's CPU went to 100%, and every other customer's requests slowed down. Another day, a script tried thousands of passwords on the login endpoint. Both problems have the same answer: **limit how often a client can call you**. ASP.NET Core has had built-in rate limiting since .NET 7 (we saw it briefly in the [.NET 7 overview](/blog/2022/12/14/whats-new-in-dotnet-7-csharp-11)). Let's use it properly: choosing an algorithm, limiting **per user** and **per IP**, protecting expensive endpoints, and answering correctly when a client is over the limit.

## The core idea: a budget per client, per time

```sql
Client A: 100 requests / minute allowed
  request 1..100   → ✅ processed
  request 101      → ❌ 429 Too Many Requests, "Retry-After: 23"
  next minute      → budget refilled
```

Rate limiting protects you from:

| Threat | Example |
|---|---|
| Accidental overload | A buggy client loop, a retry storm |
| Abuse and scraping | Someone downloading your whole catalog |
| Brute force | Password and 2FA code guessing |
| Cost explosions | An endpoint that calls a paid API or runs a heavy report |
| Noisy neighbors | One customer slowing down everybody else |

> **Rate limiting is about fairness and survival: one client must not be able to take all of your capacity.**

---

## The four algorithms

All four come with ASP.NET Core (`System.Threading.RateLimiting`):

| Limiter | How it works | Good for |
|---|---|---|
| **Fixed window** | N requests per window (e.g. 100 per minute); the counter resets at the end of each window | Simple quotas |
| **Sliding window** | Like fixed, but the window is split into segments that expire one by one | Smoother than fixed: no "double burst" at window edges |
| **Token bucket** | A bucket of tokens refilled at a steady rate; each request takes one | Allows short bursts, enforces an average rate |
| **Concurrency** | At most N requests **in progress** at the same time | Heavy endpoints (exports, reports) |

The fixed window's weakness, visually:

```sql
Limit: 100 / minute
10:00:59  → 100 requests ✅ (end of window 1)
10:01:00  → 100 requests ✅ (start of window 2)
= 200 requests in 2 seconds — allowed by a "100 per minute" rule
```

A sliding window or a token bucket avoids that burst.

---

## The setup

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;   // the default is 503!

    options.AddFixedWindowLimiter("fixed", o =>
    {
        o.PermitLimit = 100;
        o.Window = TimeSpan.FromMinutes(1);
        o.QueueLimit = 0;                    // reject immediately instead of queueing
    });

    options.AddSlidingWindowLimiter("sliding", o =>
    {
        o.PermitLimit = 100;
        o.Window = TimeSpan.FromMinutes(1);
        o.SegmentsPerWindow = 6;             // 10-second segments
    });

    options.AddTokenBucketLimiter("bucket", o =>
    {
        o.TokenLimit = 20;                   // a burst of up to 20 requests...
        o.TokensPerPeriod = 5;               // ...then 5 per second on average
        o.ReplenishmentPeriod = TimeSpan.FromSeconds(1);
    });

    options.AddConcurrencyLimiter("exports", o =>
    {
        o.PermitLimit = 2;                   // max 2 exports running at the same time
        o.QueueLimit = 5;                    // 5 more can wait for a free slot
        o.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    });
});

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();            // after auth, so policies can use the user
```

Then attach policies to endpoints:

```csharp
app.MapGet("/api/products", GetProducts).RequireRateLimiting("sliding");
app.MapPost("/api/exports/orders", ExportOrders).RequireRateLimiting("exports");

var api = app.MapGroup("/api").RequireRateLimiting("sliding");        // a whole group
api.MapGet("/health-lite", () => "OK").DisableRateLimiting();        // an exception
```

For controllers: `[EnableRateLimiting("sliding")]` and `[DisableRateLimiting]` on the class or the action.

⚠️ Set `RejectionStatusCode` to **429**. The default (503 Service Unavailable) tells clients and monitoring "the server is broken", which is exactly the wrong message.

---

## Partitions: per user, per IP

The limiters above are **shared by everybody**: 100 requests per minute for the **whole** API. One busy client consumes everyone's budget. What you usually want is a budget **per client** — a **partitioned** limiter:

```csharp
options.AddPolicy("per-user", context =>
{
    var key = context.User.FindFirstValue(ClaimTypes.NameIdentifier)       // logged-in user
              ?? context.Connection.RemoteIpAddress?.ToString()            // anonymous: by IP
              ?? "unknown";

    return RateLimitPartition.GetSlidingWindowLimiter(key, _ => new SlidingWindowRateLimiterOptions
    {
        PermitLimit = 300,
        Window = TimeSpan.FromMinutes(1),
        SegmentsPerWindow = 6,
    });
});
```

Each user (or IP) gets its own window. Different partitions can even get different limits — for example by subscription plan:

```csharp
var plan = context.User.FindFirstValue("plan");
return plan == "premium"
    ? RateLimitPartition.GetTokenBucketLimiter($"premium:{key}", _ => premiumOptions)
    : RateLimitPartition.GetTokenBucketLimiter($"free:{key}", _ => freeOptions);
```

### A global safety net

A **global limiter** applies to every request, before the endpoint policies — a ceiling no single client can exceed:

```csharp
options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 1000, Window = TimeSpan.FromMinutes(1) }));
```

---

## Protecting the login endpoint

Brute force needs **two** limits: per IP (one attacker, many usernames) and per username (many IPs, one account):

```csharp
options.AddPolicy("login", context =>
    RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(5) }));

auth.MapPost("/login", Login).RequireRateLimiting("login");
```

The per-username part belongs in the login logic itself (a failed-attempts counter and a temporary lockout, as for the codes in the [two-factor post](/blog/2024/03/06/aspnet-core-two-factor-totp)) — the request body isn't available to the limiter. Both together make guessing impractical.

---

## A good 429 response

Tell the client **when** it can try again, in the standard format:

```csharp
options.OnRejected = async (context, ct) =>
{
    if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString();

    context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
        .CreateLogger("RateLimiting")
        .LogWarning("Rate limit hit on {Path} by {Client}",
            context.HttpContext.Request.Path,
            context.HttpContext.User.Identity?.Name ?? context.HttpContext.Connection.RemoteIpAddress?.ToString());

    await context.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>().WriteAsync(new ProblemDetailsContext
    {
        HttpContext = context.HttpContext,
        ProblemDetails = { Status = 429, Title = "Too many requests", Detail = "Please slow down and retry later." },
    });
};
```

```sql
HTTP/1.1 429 Too Many Requests
Retry-After: 23
Content-Type: application/problem+json

{ "status": 429, "title": "Too many requests", "detail": "Please slow down and retry later.", ... }
```

Well-behaved clients — including .NET clients using the [resilience handler](/blog/2024/08/14/dotnet-8-http-resilience), which retries 429s and honors `Retry-After` — will slow down automatically. And log rejections (at `Warning`, not `Error`): a sudden spike is often the first sign of a buggy integration or an attack.

---

## Behind a proxy: the real client IP

Behind a load balancer or reverse proxy, `RemoteIpAddress` is the **proxy's** address — every client shares one partition, and one heavy user blocks everybody. Read the real IP from the forwarded headers, trusting only your own proxies:

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Add(IPAddress.Parse("10.0.0.10"));     // your load balancer
});

app.UseForwardedHeaders();     // before UseRateLimiter
```

Never trust `X-Forwarded-For` from anyone: without `KnownProxies`, an attacker can send a random IP in the header on every request and get a fresh budget each time.

---

## Limits of in-process rate limiting

The built-in limiters keep their counters **in the memory of each instance**:

```sql
Limit 100/min, 3 instances behind a load balancer → a client can actually make ~300/min
App restart → all counters reset
```

That's fine for most purposes (protection against overload and abuse). When limits must be **exact** across instances (paid API quotas, billing), enforce them in a shared place: an API gateway in front of the instances, or a limiter backed by a shared store like Redis.

And remember the difference with the August post: `AddStandardResilienceHandler`'s rate limiter protects a dependency **you call** (outgoing); this post protects **your** API (incoming).

---

## Key rules to remember

| Rule | Why |
|---|---|
| Set `RejectionStatusCode = 429` | The default 503 says "server broken" |
| `UseRateLimiter()` after authentication | Policies can partition by user |
| Partition per user (or IP for anonymous calls) | One client can't consume everyone's budget |
| Sliding window or token bucket over fixed window | No double bursts at window edges |
| Concurrency limiter for heavy endpoints | Exports and reports can't saturate the database |
| A global limiter as a safety net | A ceiling no client can exceed |
| Login: per-IP limiter + per-account lockout | Both kinds of brute force |
| Send `Retry-After` and ProblemDetails, log at Warning | Clients back off, you see abuse early |
| Forwarded headers with known proxies only | Real client IPs, no spoofed partitions |
| In-memory limits are per instance | Use a gateway or shared store for exact quotas |

>
> ## That's it & see you soon!.
>
