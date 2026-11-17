---
layout: post
title: "Resilient HttpClient in .NET 8 - Microsoft.Extensions.Http.Resilience and Polly v8"
date: 2024-08-14
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['.Net', 'Asp.Net']
description: 'Resilient HttpClient in .NET 8 - Microsoft.Extensions.Http.Resilience and Polly v8'
image: /images/covers/dotnet-8-http-resilience.png
---

In 2022 we built [typed HttpClients with retries and a circuit breaker](/blog/2022/04/13/dotnet-httpclient-factory-typed-clients) using Polly v7 policies: a few lines per client, a few decisions per line (how many retries? which delays? which errors?). Most teams ended up copying the same block everywhere — sometimes with retries **inside** a timeout that was shorter than the retries. .NET 8 ships **Microsoft.Extensions.Http.Resilience**, built on Polly v8: one line gives you a well-designed pipeline of five strategies, with sensible defaults, logging and metrics. Let's see what's inside, how to tune it, and the traps that remain (hello, retried `POST`s).

## The core idea: transient failures are normal

Calls to other services fail **sometimes**, for reasons that fix themselves: a deployment restarting instances, a load balancer hiccup, a brief network drop, a `429 Too Many Requests`. Resilience is about making those failures **invisible** to users — without making real outages worse.

```sql
Without resilience:  1 failed call → 1 failed user request
With resilience:     1 failed call → wait 2 s → retry → success → the user never knew
But careful:         a service really down + aggressive retries → you multiply its load → it stays down
```

> **Retry what is likely to work next time, stop calling what is clearly down, and always bound the total time.**

---

## From Polly v7 policies to v8 pipelines

| | 2022: Polly v7 + `Microsoft.Extensions.Http.Polly` | 2024: Polly v8 + `Microsoft.Extensions.Http.Resilience` |
|---|---|---|
| Building block | Policies (`WaitAndRetryAsync`, `CircuitBreakerAsync`) | **Strategies** combined in a **pipeline** |
| Setup | You choose and order each policy | `AddStandardResilienceHandler()` — a complete pipeline |
| Defaults | None | Retries with jitter, timeouts, breaker, rate limiter |
| Configuration | Code | Options objects, bindable to `appsettings.json` |
| Telemetry | Do it yourself | Logs and metrics built in |
| Performance | Allocations per execution | Designed for low allocations |

The old package still works, but for new code in .NET 8, the new one is the recommended path.

```sql
dotnet add package Microsoft.Extensions.Http.Resilience
```

---

## AddStandardResilienceHandler: one line

```csharp
builder.Services.AddHttpClient<RatesClient>(c => c.BaseAddress = new Uri("https://rates.example.com"))
    .AddStandardResilienceHandler();
```

That line adds **five strategies**, in this order (outermost first):

```sql
request ──► 1. Rate limiter            limits concurrent requests to this dependency (default 1,000)
        ──► 2. Total request timeout   the WHOLE operation, retries included (default 30 s)
        ──► 3. Retry                   up to 3 retries, exponential backoff + jitter (2 s base)
        ──► 4. Circuit breaker         opens when ≥ 10% of calls fail in 30 s (min. 100 calls), for 5 s
        ──► 5. Attempt timeout         each single attempt (default 10 s)
        ──► HttpClient → network
```

The order is what makes it safe:

- The **attempt timeout** is inside the retry: a stuck attempt is cancelled after 10 s and **retried**.
- The **total timeout** is outside the retry: whatever happens, the caller waits at most 30 s.
- The **circuit breaker** is between them: when the dependency is clearly down, retries stop immediately (`BrokenCircuitException`) instead of piling up.

Retries happen for transient errors: network exceptions, timeouts, `5xx`, `408` and `429` — not for `400`, `401` or `404`, which won't succeed by trying again.

**Jitter** (a random part in each delay) matters more than it looks: without it, 500 clients that failed at the same second all retry at the same second — a self-made traffic spike.

---

## Tuning the defaults

The defaults are reasonable for "a typical internal API". Adjust them to the dependency:

```csharp
builder.Services.AddHttpClient<RatesClient>(c => c.BaseAddress = new Uri("https://rates.example.com"))
    .AddStandardResilienceHandler(options =>
    {
        options.AttemptTimeout.Timeout = TimeSpan.FromSeconds(3);        // this API is normally fast
        options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(12);
        options.Retry.MaxRetryAttempts = 2;
        options.Retry.Delay = TimeSpan.FromMilliseconds(500);
        options.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(20);  // must be ≥ 2 × attempt timeout
        options.CircuitBreaker.FailureRatio = 0.2;
    });
```

The options are **validated at startup**: inconsistent values (an attempt timeout longer than the total timeout, a sampling duration too short) throw instead of silently doing something odd.

Or bind them from configuration, so each environment can tune without a deployment:

```csharp
.AddStandardResilienceHandler(builder.Configuration.GetSection("Resilience:Rates"));
```

```json
"Resilience": {
  "Rates": {
    "AttemptTimeout": { "Timeout": "00:00:03" },
    "TotalRequestTimeout": { "Timeout": "00:00:12" },
    "Retry": { "MaxRetryAttempts": 2, "Delay": "00:00:00.500" }
  }
}
```

One more thing: `HttpClient.Timeout` (100 s by default) still applies **around** the whole pipeline. Don't set it **shorter** than the total request timeout, or it cuts the retries short.

---

## Hedging: for slow, not failing, dependencies

Sometimes the dependency doesn't fail — one request out of fifty is just very slow. **Hedging** sends a second request in parallel if the first one hasn't answered after a short delay, and takes whichever answers first:

```csharp
builder.Services.AddHttpClient<CatalogClient>(c => c.BaseAddress = new Uri("https://catalog.example.com"))
    .AddStandardHedgingHandler();
```

```sql
t=0 ms     request A sent
t=2000 ms  no answer yet → request B sent (hedge)
t=2150 ms  B answers → use B, cancel A
```

Use it only for **idempotent reads** (`GET`s) against services that can absorb the extra load — every hedge is a real extra request. It's the standard handler's alternative, not an addition: use one or the other on a client.

---

## Custom pipelines

When the standard pipeline doesn't fit, build your own with the same strategies:

```csharp
builder.Services.AddHttpClient<PaymentsClient>(c => c.BaseAddress = new Uri("https://payments.example.com"))
    .AddResilienceHandler("payments", pipeline =>
    {
        pipeline.AddTimeout(TimeSpan.FromSeconds(20));                 // total
        pipeline.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 2,
            BackoffType = DelayBackoffType.Exponential,
            UseJitter = true,
            Delay = TimeSpan.FromSeconds(1),
        });
        pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5,
            MinimumThroughput = 10,
            SamplingDuration = TimeSpan.FromSeconds(30),
            BreakDuration = TimeSpan.FromSeconds(15),
        });
        pipeline.AddTimeout(TimeSpan.FromSeconds(5));                  // per attempt
    });
```

The order you add strategies **is** the order of the pipeline — outermost first, exactly like the standard one.

---

## Idempotency: careful with retried POSTs

The standard pipeline retries **every HTTP method** by default. Consider:

```sql
POST /payments → the payment is created → the response is lost (network drop)
retry: POST /payments → a SECOND payment is created 😱
```

For calls that create or change something, choose one of these:

```csharp
// 1. Don't retry unsafe methods (POST, PUT, PATCH, DELETE)
.AddStandardResilienceHandler(o => o.Retry.DisableForUnsafeHttpMethods());

// 2. Or make the operation idempotent: send a key the server uses to detect duplicates
request.Headers.Add("Idempotency-Key", paymentRequest.Id.ToString());
```

Option 2 is better when the API supports it (most payment providers do): retries become safe, and you keep the resilience.

---

## Observability: built in

Every retry, timeout and circuit state change is **logged** (with the client name and the reason) and recorded as a **metric** (`resilience.polly.strategy.events`). With structured logging in place (see the [Serilog post](/blog/2024/06/12/structured-logging-dotnet-serilog)), you can answer questions like:

```sql
"How often do we retry calls to the rates API?"     → count events by strategy and client
"When did the payments circuit open last week?"     → OnCircuitOpened events
```

A dependency that needs retries on 5% of calls is a dependency with a problem — the metrics tell you before the users do.

---

## Testing resilience

Use a fake primary handler that fails a few times before succeeding, and zero delays so the test is fast:

```csharp
public sealed class FlakyHandler(int failuresBeforeSuccess) : HttpMessageHandler
{
    public int Calls { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Calls++;
        var status = Calls <= failuresBeforeSuccess ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK;
        return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent("{}") });
    }
}

[Fact]
public async Task Transient_failures_are_retried()
{
    var flaky = new FlakyHandler(failuresBeforeSuccess: 2);

    var services = new ServiceCollection();
    services.AddHttpClient<RatesClient>(c => c.BaseAddress = new Uri("https://rates.test"))
        .ConfigurePrimaryHttpMessageHandler(() => flaky)
        .AddStandardResilienceHandler(o => o.Retry.Delay = TimeSpan.Zero);

    var client = services.BuildServiceProvider().GetRequiredService<RatesClient>();
    await client.GetRawAsync("/rates/EUR");

    Assert.Equal(3, flaky.Calls);      // 2 failures + 1 success
}
```

The same approach tests the circuit breaker (many failures → `BrokenCircuitException`) and timeouts (a handler that waits longer than the attempt timeout).

---

## Key rules to remember

| Rule | Why |
|---|---|
| Transient failures are normal: retry them, with jitter | Short glitches become invisible |
| `AddStandardResilienceHandler()` for most clients | A complete, well-ordered pipeline in one line |
| Attempt timeout inside retry, total timeout outside | Stuck attempts are retried, callers wait a bounded time |
| Circuit breaker between them | No retry storms against a service that's down |
| Tune per dependency, bind options from configuration | Fast APIs get short timeouts; tune without deploying |
| Keep `HttpClient.Timeout` ≥ total request timeout | Otherwise it cuts retries short |
| Hedging only for idempotent reads, instead of the standard handler | It multiplies requests |
| Don't retry unsafe methods unless the call is idempotent | A lost response doesn't mean the call failed |
| Watch the resilience logs and metrics | Frequent retries reveal unhealthy dependencies |
| Test with a fake failing handler and zero delays | Fast, deterministic resilience tests |

>
> ## That's it & see you soon!.
>
