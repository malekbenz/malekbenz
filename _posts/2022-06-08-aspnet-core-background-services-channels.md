---
layout: post
title: "Background work in ASP.NET Core - BackgroundService, PeriodicTimer and Channels"
date: 2022-06-08
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: 'Background work in ASP.NET Core - BackgroundService, PeriodicTimer and Channels'
image: /images/covers/aspnet-core-background-services-channels.png
---

Placing an order takes 4 seconds — not because of the order, but because the endpoint also generates a PDF invoice and sends the confirmation email before answering. Every night, someone has to remember to run the "close expired carts" script. Both are **background work**: things that must happen, but not inside the user's request. ASP.NET Core has everything needed for this, built in: `BackgroundService` for long-running work, `PeriodicTimer` for jobs on a schedule, and `Channel<T>` for a fast in-memory work queue. Let's build each one properly — including the details that make the difference in production: scopes, exceptions and shutdown.

## The core idea: work that doesn't belong in the request

```sql
Before:  POST /orders → save order → generate PDF → send email → 200 OK    (4 s)
After:   POST /orders → save order → queue "send confirmation" → 200 OK    (150 ms)
                                          │
                     background worker ───┘→ generate PDF → send email (a few seconds later)
```

Rule of thumb: if the user doesn't need the **result** to continue, it doesn't need to be in the request.

> **A background service runs inside your app's process, for its whole lifetime, next to the requests. Simple and free — with limits we'll see at the end.**

---

## IHostedService and BackgroundService

`IHostedService` is the low-level interface: the host calls `StartAsync` at startup and `StopAsync` at shutdown. `BackgroundService` is the convenient base class — you implement **one** method:

```csharp
public sealed class HeartbeatService : BackgroundService
{
    private readonly ILogger<HeartbeatService> _logger;

    public HeartbeatService(ILogger<HeartbeatService> logger) => _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Still alive at {Time}", DateTimeOffset.Now);
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}

builder.Services.AddHostedService<HeartbeatService>();
```

`stoppingToken` is cancelled when the app shuts down — every loop and every `await` should use it.

One trap: the code **before the first `await`** in `ExecuteAsync` runs during application startup. A long synchronous loop there blocks the app from starting. Starting with `await Task.Yield();` (or any real `await`) avoids it.

---

## A periodic job with PeriodicTimer

.NET 6 added `PeriodicTimer`, made for exactly this:

```csharp
public sealed class ExpiredCartsCleaner : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ExpiredCartsCleaner> _logger;

    public ExpiredCartsCleaner(IServiceScopeFactory scopeFactory, ILogger<ExpiredCartsCleaner> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var carts = scope.ServiceProvider.GetRequiredService<ICartRepository>();

                var removed = await carts.DeleteExpiredAsync(olderThan: TimeSpan.FromDays(7), stoppingToken);
                _logger.LogInformation("Removed {Count} expired carts", removed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Cleaning expired carts failed, will retry next tick");
            }
        }
    }
}
```

Why `PeriodicTimer` instead of `Task.Delay` in a loop?

| | `Task.Delay(15 min)` loop | `PeriodicTimer(15 min)` |
|---|---|---|
| Interval | Work time **+** 15 min (drifts) | Every 15 min (ticks don't pile up if work is slow) |
| Overlapping runs | No | No — one tick at a time |
| Cancellation | Via the token | Via the token, `WaitForNextTickAsync` returns `false` |

---

## Scoped services in a background service

A `BackgroundService` is a **singleton**: it lives as long as the app. Injecting a `DbContext` or a repository directly would make it a captive dependency (see the [DI lifetimes post](/blog/2022/02/09/dotnet-dependency-injection-lifetimes)) — one `DbContext` for days, growing and eventually broken.

The pattern above is the right one: inject `IServiceScopeFactory`, and create **one scope per unit of work** (per tick, per message). The scope and everything in it are disposed at the end of each iteration.

---

## Exceptions: in .NET 6, an unhandled error stops the app

This changed in .NET 6: if `ExecuteAsync` throws an unhandled exception, the host **stops the whole application** (in earlier versions, the service died silently and the app kept running without it).

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (true)
    {
        await DoWorkAsync();        // ❌ one exception → the whole web app shuts down
    }
}
```

That's why the job above wraps **each iteration** in a `try/catch`: one failed run is logged, and the next tick tries again. The old behavior can be restored, but it's rarely what you want — a dead service that nobody notices is worse:

```csharp
builder.Services.Configure<HostOptions>(o =>
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore);
```

---

## Graceful shutdown

When the app stops (deployment, restart, scale down), the host cancels `stoppingToken` and waits for background services to finish — but only for **5 seconds** by default in .NET 6. After that, the process exits, whatever was running.

```csharp
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(30));
```

Design work so it can be **interrupted safely**: small units, idempotent operations, pass `stoppingToken` to every async call so they stop quickly instead of being killed in the middle.

---

## A work queue with Channels

Back to the 4-second order. We want the endpoint to **hand off** the work and answer immediately. `System.Threading.Channels` provides a fast, thread-safe, async producer/consumer queue — in memory.

### The queue

```csharp
public sealed record OrderConfirmation(int OrderId, string Email);

public sealed class ConfirmationQueue
{
    private readonly Channel<OrderConfirmation> _channel =
        Channel.CreateBounded<OrderConfirmation>(new BoundedChannelOptions(1000)
        {
            FullMode = BoundedChannelFullMode.Wait,   // when full, producers wait (back-pressure)
            SingleReader = true,
        });

    public ValueTask EnqueueAsync(OrderConfirmation item, CancellationToken ct) =>
        _channel.Writer.WriteAsync(item, ct);

    public IAsyncEnumerable<OrderConfirmation> ReadAllAsync(CancellationToken ct) =>
        _channel.Reader.ReadAllAsync(ct);
}

builder.Services.AddSingleton<ConfirmationQueue>();
```

**Bounded** means the queue has a maximum size. If emails can't be sent for a while, an **unbounded** channel would grow until the app runs out of memory; a bounded one makes producers wait (or drops items, depending on `FullMode`) — that's **back-pressure**.

### The producer: the endpoint

```csharp
app.MapPost("/api/orders", async (CreateOrderRequest request, IOrderService orders,
    ConfirmationQueue queue, CancellationToken ct) =>
{
    var order = await orders.CreateAsync(request, ct);
    await queue.EnqueueAsync(new OrderConfirmation(order.Id, order.CustomerEmail), ct);
    return Results.Created($"/api/orders/{order.Id}", order);     // ~150 ms
});
```

### The consumer: a BackgroundService

```csharp
public sealed class ConfirmationSender : BackgroundService
{
    private readonly ConfirmationQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ConfirmationSender> _logger;

    public ConfirmationSender(ConfirmationQueue queue, IServiceScopeFactory scopeFactory, ILogger<ConfirmationSender> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var item in _queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var invoices = scope.ServiceProvider.GetRequiredService<IInvoiceService>();
                var mailer = scope.ServiceProvider.GetRequiredService<IMailer>();

                var pdf = await invoices.GeneratePdfAsync(item.OrderId, stoppingToken);
                await mailer.SendAsync(item.Email, "Your order", pdf, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Confirmation for order {OrderId} failed", item.OrderId);
            }
        }
    }
}

builder.Services.AddHostedService<ConfirmationSender>();
```

The request is fast, the work happens a moment later, and a failing email doesn't break the order.

---

## The limits: when you need a real queue

A `Channel` lives in **memory**:

```sql
Order saved → item in the channel → the app restarts (deployment!) → the item is GONE
```

No email, and no trace of it. Also, with **several instances** of the app, each has its own channel and its own background services. Know the limits:

| Need | In-process (Channel + BackgroundService) | External queue (RabbitMQ, Azure Service Bus...) |
|---|---|---|
| Survives restarts and deployments | ❌ | ✅ |
| Retries with delay, dead-letter for failures | Write it yourself | ✅ Built in |
| Work shared between several app instances | ❌ | ✅ |
| Extra infrastructure | None | A broker to run |
| Good for | Best-effort, non-critical work (cache warmup, notifications you can lose) | Anything that **must** happen (emails, payments, integrations) |

A middle ground used often: save a "pending confirmation" row in the database in the **same transaction** as the order, and let a periodic background job process pending rows. Nothing is lost on restart. (We'll see a real message broker, RabbitMQ, later this year.)

### Several instances: jobs running twice

With two app instances, `ExpiredCartsCleaner` runs **twice** every 15 minutes. For a cleanup that's harmless (the second run finds nothing). For "send the monthly report", it isn't. Options: make jobs idempotent, use a database lock (`sp_getapplock` in SQL Server) so only one instance runs the job, or run scheduled jobs in a separate single-instance worker.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Move work the user doesn't wait for out of the request | Fast responses, failures don't break the main action |
| Inherit `BackgroundService`, honor `stoppingToken` everywhere | Clean, cancellable loops |
| Start `ExecuteAsync` with a real `await` | Synchronous code there blocks app startup |
| `PeriodicTimer` for scheduled jobs | No drift, no overlapping runs |
| One scope per unit of work (`IServiceScopeFactory`) | Background services are singletons |
| `try/catch` each iteration | In .NET 6, an unhandled exception stops the whole app |
| Raise `ShutdownTimeout` if work needs it (default 5 s) | Otherwise work is killed mid-way |
| `Channel.CreateBounded` for in-memory queues | Back-pressure instead of memory explosions |
| Channels lose items on restart | Use the database or a broker for work that must happen |
| Several instances = jobs run several times | Idempotent jobs or a lock |

>
> ## That's it & see you soon!.
>
