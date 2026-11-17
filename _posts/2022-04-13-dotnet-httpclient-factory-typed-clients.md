---
layout: post
title: "HttpClient the right way in .NET - IHttpClientFactory, typed clients and handlers"
date: 2022-04-13
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['.Net', 'Asp.Net']
description: 'HttpClient the right way in .NET - IHttpClientFactory, typed clients and handlers'
image: /images/covers/dotnet-httpclient-factory-typed-clients.png
---

The service works fine in tests. After a few hours in production, calls to the partner API start failing with `SocketException: Only one usage of each socket address is normally permitted`. Restart, it works again... for a few hours. Or the opposite story: the partner moves to a new server, its DNS changes, and your app keeps calling the **old** IP until someone restarts it. Both are caused by `HttpClient` used the "obvious" way. Let's see why, and the right way in .NET 6: `IHttpClientFactory`, typed clients, delegating handlers and retries with Polly.

## Problem 1: new HttpClient() for each call

```csharp
public async Task<Rate> GetRateAsync(string currency)
{
    using var client = new HttpClient();          // ❌ looks clean, uses "using"...
    return await client.GetFromJsonAsync<Rate>($"https://rates.example.com/{currency}");
}
```

`HttpClient` implements `IDisposable`, so `using` looks right. But disposing it closes the underlying **TCP connection**, and a closed connection stays in the `TIME_WAIT` state for up to a few minutes in the operating system.

```sql
1 call  = 1 new connection → closed → TIME_WAIT (~2-4 min)
1,000 calls/min = thousands of sockets waiting → no free ports → SocketException
```

Under load, you run out of sockets. Each call also pays the cost of a new TCP + TLS handshake.

## Problem 2: one static HttpClient forever

The classic "fix":

```csharp
private static readonly HttpClient Client = new();   // reused: no socket exhaustion...
```

Connections are reused — great. But a connection, once open, stays open, and the DNS is only resolved when a **new** connection is created. If the API's IP changes (failover, load balancer, cloud migration), your app keeps talking to the old address.

```sql
new HttpClient per call   →  socket exhaustion
one static HttpClient     →  stale DNS
```

> **The goal: reuse connections, but not forever. That's exactly what IHttpClientFactory does.**

---

## The fix: IHttpClientFactory

The factory keeps a **pool of handlers** (the object that owns the connections) and **rotates** them: each handler lives 2 minutes by default, then new clients get a fresh handler, and the old one is disposed once nobody uses it.

```sql
CreateClient() ──► cheap HttpClient wrapper ──► pooled HttpMessageHandler (connections)
                                                 └─ replaced every 2 minutes → DNS refreshed
```

`HttpClient` instances from the factory are cheap — create one when you need it, don't keep it.

### Basic usage

```csharp
builder.Services.AddHttpClient();

public class RatesService
{
    private readonly IHttpClientFactory _factory;
    public RatesService(IHttpClientFactory factory) => _factory = factory;

    public async Task<Rate?> GetRateAsync(string currency, CancellationToken ct)
    {
        var client = _factory.CreateClient();
        return await client.GetFromJsonAsync<Rate>($"https://rates.example.com/{currency}", ct);
    }
}
```

### Named clients: configuration in one place

```csharp
builder.Services.AddHttpClient("rates", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Rates:BaseUrl"]!);
    client.DefaultRequestHeaders.Add("Accept", "application/json");
    client.Timeout = TimeSpan.FromSeconds(10);
});

var client = _factory.CreateClient("rates");
var rate = await client.GetFromJsonAsync<Rate>($"/{currency}", ct);
```

The base URL, headers and timeout are configured **once**, not repeated in every call. But the name is a magic string.

---

## Typed clients: the cleanest option

A typed client is a class that **receives** a configured `HttpClient` and exposes meaningful methods:

```csharp
public class RatesClient
{
    private readonly HttpClient _http;

    public RatesClient(HttpClient http) => _http = http;

    public Task<Rate?> GetRateAsync(string currency, CancellationToken ct = default) =>
        _http.GetFromJsonAsync<Rate>($"/rates/{Uri.EscapeDataString(currency)}", ct);

    public async Task<IReadOnlyList<Rate>> GetAllAsync(CancellationToken ct = default) =>
        await _http.GetFromJsonAsync<List<Rate>>("/rates", ct) ?? new List<Rate>();
}
```

```csharp
builder.Services.AddHttpClient<RatesClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Rates:BaseUrl"]!);
    client.Timeout = TimeSpan.FromSeconds(10);
});

public class PricingService
{
    private readonly RatesClient _rates;
    public PricingService(RatesClient rates) => _rates = rates;     // injected like any service
}
```

The rest of the app talks to `RatesClient.GetRateAsync(...)` — not to URLs. Changing the API's routes means changing **one** class, and in tests you can replace `RatesClient` (or its handler) easily.

| Style | Pros | Cons |
|---|---|---|
| `CreateClient()` | Quick | Configuration repeated in each call |
| Named client | Configuration centralized | Magic strings, `HttpClient` methods everywhere |
| **Typed client** | Configuration + a real API in one class | One class per external API (that's a good thing) |

---

## DelegatingHandler: middleware for outgoing requests

Like ASP.NET Core middleware, but for requests you **send**. Perfect for anything every call needs: an auth header, a correlation id, logging.

```csharp
public class ApiKeyHandler : DelegatingHandler
{
    private readonly IConfiguration _config;
    public ApiKeyHandler(IConfiguration config) => _config = config;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        request.Headers.Remove("X-Api-Key");                    // Add() appends — remove first on retries
        request.Headers.Add("X-Api-Key", _config["Rates:ApiKey"]);
        return base.SendAsync(request, ct);
    }
}

public class CorrelationIdHandler : DelegatingHandler
{
    private readonly IHttpContextAccessor _accessor;
    public CorrelationIdHandler(IHttpContextAccessor accessor) => _accessor = accessor;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var id = _accessor.HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString();
        request.Headers.TryAddWithoutValidation("X-Correlation-Id", id);
        return base.SendAsync(request, ct);
    }
}
```

```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddTransient<ApiKeyHandler>();
builder.Services.AddTransient<CorrelationIdHandler>();

builder.Services.AddHttpClient<RatesClient>(c => c.BaseAddress = new Uri("https://rates.example.com"))
    .AddHttpMessageHandler<CorrelationIdHandler>()
    .AddHttpMessageHandler<ApiKeyHandler>();
```

Handlers run in the order they're added, wrapping each other like middleware. The typed client code stays clean — it never deals with keys or headers.

---

## Resilience with Polly

Networks fail: a timeout, a `503` during a deployment, a load balancer hiccup. Most of these are **transient** — trying again a moment later works. The `Microsoft.Extensions.Http.Polly` package plugs Polly policies into the factory:

```sql
dotnet add package Microsoft.Extensions.Http.Polly
```

```csharp
builder.Services.AddHttpClient<RatesClient>(c => c.BaseAddress = new Uri("https://rates.example.com"))
    // Retry 3 times on network errors, 5xx and 408 — waiting 200 ms, 400 ms, 800 ms
    .AddTransientHttpErrorPolicy(p => p.WaitAndRetryAsync(3, attempt => TimeSpan.FromMilliseconds(100 * Math.Pow(2, attempt))))
    // After 5 consecutive failures, stop calling for 30 s (fail fast instead of piling up)
    .AddTransientHttpErrorPolicy(p => p.CircuitBreakerAsync(5, TimeSpan.FromSeconds(30)));
```

| Policy | What it does | Why |
|---|---|---|
| Retry with backoff | Tries again, waiting longer each time | Survives short glitches |
| Circuit breaker | After N failures, fails immediately for a while | Doesn't hammer a service that's down, frees your threads |
| Timeout (per try) | Gives up on one slow attempt | One stuck call doesn't use the whole budget |

Be careful with retries on **non-idempotent** requests: retrying a `POST /payments` that actually succeeded (but whose response was lost) can charge twice. Retry `GET`s freely; for `POST`s, use an idempotency key or don't retry.

---

## Timeouts and cancellation

`HttpClient.Timeout` is **100 seconds** by default — far too long for most APIs. Set it per client, and pass the request's `CancellationToken` so an aborted request stops its outgoing calls too (see the [async/await post](/blog/2022/03/09/csharp-async-await-explained)):

```csharp
public Task<Rate?> GetRateAsync(string currency, CancellationToken ct) =>
    _http.GetFromJsonAsync<Rate>($"/rates/{currency}", ct);
```

And check status codes: `GetFromJsonAsync` throws on non-success, but `GetAsync` doesn't — call `response.EnsureSuccessStatusCode()` or check `response.IsSuccessStatusCode` yourself.

---

## The typed client lifetime trap

Typed clients are registered as **transient**. Their `HttpClient` gets a handler from the pool, which the factory rotates — **as long as new typed clients keep being created**.

```csharp
builder.Services.AddSingleton<PriceCache>();    // a singleton...

public class PriceCache
{
    private readonly RatesClient _rates;        // ❌ ...holding a typed client forever
    public PriceCache(RatesClient rates) => _rates = rates;
}
```

The singleton keeps **one** `RatesClient` — and one handler — for the life of the app: we're back to problem 2, stale DNS. It's the same captive dependency as in the [DI lifetimes post](/blog/2022/02/09/dotnet-dependency-injection-lifetimes). In a singleton, inject `IHttpClientFactory` and create clients when needed, or create a scope.

---

## Outside of DI: SocketsHttpHandler

In a small console app without DI, you can get the same benefits with one long-lived client and a connection lifetime:

```csharp
private static readonly HttpClient Client = new(new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2)    // reconnect every 2 minutes → fresh DNS
});
```

Connections are reused, and recycled regularly. For ASP.NET Core apps, prefer the factory: it also gives you handlers, logging and Polly.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Never `new HttpClient()` per call | Socket exhaustion under load |
| Don't keep one `HttpClient` forever without a connection lifetime | DNS changes are ignored |
| Use `IHttpClientFactory` in ASP.NET Core | Pooled, rotated handlers |
| Prefer typed clients | Configuration + a real API in one class |
| `DelegatingHandler` for headers, auth, correlation ids | Cross-cutting concerns out of the client code |
| Retries with backoff + circuit breaker (Polly) | Survive glitches, fail fast when a service is down |
| Don't blindly retry non-idempotent requests | A lost response doesn't mean the call failed |
| Set a short `Timeout`, pass `CancellationToken` | The default is 100 seconds |
| Don't inject typed clients into singletons | Same captive-dependency problem |
| Outside DI: `SocketsHttpHandler.PooledConnectionLifetime` | Reuse with regular reconnects |

>
> ## That's it & see you soon!.
>
