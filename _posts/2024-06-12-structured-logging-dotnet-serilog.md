---
layout: post
title: "Structured logging in .NET 8 with Serilog - Message templates, enrichers and sinks"
date: 2024-06-12
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'Asp.Net', 'C#', 'Serilog']
categories: ['.Net', 'Asp.Net']
description: 'Structured logging in .NET 8 with Serilog - Message templates, enrichers and sinks'
image: /images/covers/structured-logging-dotnet-serilog.png
---

A customer says order 48213 failed yesterday afternoon. You open the server, find 4 GB of text log files, and start searching for `48213` — in lines like `Error processing order 48213 for customer jane@example.com`, mixed with thousands of others, from three different servers. With **structured logging**, the same question is a query: `OrderId = 48213`, and you get every event for that order, from every server, with the request, the user and the duration. Let's set it up with **Serilog** in .NET 8, and avoid the one mistake that silently breaks it: string interpolation.

## The core idea: events with properties, not sentences

```csharp
_logger.LogInformation("Order {OrderId} placed by {CustomerId} for {Total} €", order.Id, order.CustomerId, order.Total);
```

A classic logger turns this into a line of text. A **structured** logger keeps the **template** and the **values** separately:

```json
{
  "@t": "2024-06-11T14:32:05.412Z",
  "@mt": "Order {OrderId} placed by {CustomerId} for {Total} €",
  "OrderId": 48213,
  "CustomerId": 907,
  "Total": 129.9,
  "RequestPath": "/api/orders",
  "MachineName": "web-02"
}
```

Now a log server can **filter** (`OrderId = 48213`), **group** (orders per customer), and **aggregate** (average `Total`), because the values are typed fields, not words in a sentence.

> **Log events, not strings. The message is for humans; the properties are for queries.**

---

## Message templates vs string interpolation

The most common mistake, everywhere:

```csharp
// ❌ Interpolation: the string is built BEFORE the logger sees it
_logger.LogInformation($"Order {order.Id} placed by {order.CustomerId}");

// ✅ Message template: the logger receives the template + the values
_logger.LogInformation("Order {OrderId} placed by {CustomerId}", order.Id, order.CustomerId);
```

Both print the same text in the console. But with `$"..."`:

- there are **no properties** — `OrderId` doesn't exist, you're back to text search;
- every event has a **different** template, so you can't group "all order-placed events";
- the string is built **even when the level is disabled** (wasted CPU and allocations on hot paths).

Rules for templates: use **PascalCase names** (`{OrderId}`), keep the **same name** for the same thing across the app, and pass values in order. To log an object's properties, add `@`: `"{@Address}"` (destructured) — but only for small objects.

---

## Log levels: what goes where

| Level | Use for | Example |
|---|---|---|
| `Trace` / `Verbose` | Very detailed internals, off in production | Each step of a parser |
| `Debug` | Useful when debugging, off in production | Cache hit/miss for a key |
| `Information` | Normal business events, the "story" of the app | Order placed, user logged in |
| `Warning` | Unexpected but handled, worth a look | Retry #2 to the payment API, slow query |
| `Error` | An operation failed | Order could not be saved (with the exception) |
| `Critical` / `Fatal` | The app can't continue | Cannot connect to the database at startup |

If a log line never helped anyone fix anything, it's probably `Debug`. If an `Error` happens 500 times a day and nobody reacts, it's either a real bug to fix or the wrong level.

---

## Setting up Serilog

```sql
dotnet add package Serilog.AspNetCore
dotnet add package Serilog.Settings.Configuration
dotnet add package Serilog.Enrichers.Environment
dotnet add package Serilog.Sinks.Seq
```

### The bootstrap logger: catch startup crashes

```csharp
// Program.cs
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();                  // usable immediately, replaced once config is loaded

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Services.AddSerilog((services, lc) => lc
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext());

    // ... services ...

    var app = builder.Build();
    app.UseSerilogRequestLogging();
    // ... pipeline ...
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();                       // write buffered events before the process exits
}
```

Without the bootstrap logger and the `try/catch`, an error in configuration or DI at startup just kills the process — and on a server (or a Windows service), you have no idea why. `CloseAndFlush` matters too: sinks buffer events, and without it the **last** ones — often the most important — are lost.

### Configuration in appsettings.json

```json
{
  "Serilog": {
    "Using": [ "Serilog.Sinks.Console", "Serilog.Sinks.File", "Serilog.Sinks.Seq" ],
    "MinimumLevel": {
      "Default": "Information",
      "Override": {
        "Microsoft.AspNetCore": "Warning",
        "Microsoft.EntityFrameworkCore.Database.Command": "Warning",
        "System.Net.Http.HttpClient": "Warning"
      }
    },
    "WriteTo": [
      { "Name": "Console" },
      {
        "Name": "File",
        "Args": {
          "path": "logs/app-.json",
          "rollingInterval": "Day",
          "retainedFileCountLimit": 14,
          "formatter": "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact"
        }
      },
      { "Name": "Seq", "Args": { "serverUrl": "http://localhost:5341" } }
    ],
    "Enrich": [ "FromLogContext", "WithMachineName", "WithEnvironmentName" ],
    "Properties": { "Application": "Malekbenz.Api" }
  }
}
```

- **`Override`**: ASP.NET Core and EF Core are very talkative at `Information`. Raise them to `Warning` and keep **your** code at `Information`.
- **File sink**: rolling daily files, kept 14 days, in **JSON** — so they can be shipped to a log server later without parsing text.
- **`Application` property**: when several apps send logs to the same server, you can filter by app.
- Levels can be changed per environment in `appsettings.Development.json` — no code change.

---

## Enrichers: context on every event

Enrichers add properties to **every** event automatically:

| Enricher | Adds | Why |
|---|---|---|
| `FromLogContext` | Properties pushed with `LogContext` or logger scopes | Per-request / per-operation context |
| `WithMachineName` | `MachineName` | Which server, when you run several |
| `WithEnvironmentName` | `EnvironmentName` | Production vs staging in one log server |
| `Properties` | `Application`, version... | Filter by app |

The most useful context — the **user** and a **correlation id** — comes per request. A tiny middleware:

```csharp
app.Use(async (context, next) =>
{
    using (LogContext.PushProperty("UserId", context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous"))
    using (LogContext.PushProperty("CorrelationId", context.TraceIdentifier))
    {
        await next();
    }
});
```

Place it **after** authentication (so the user is known). Every log written during the request — in controllers, services, repositories — now carries `UserId` and `CorrelationId`.

---

## UseSerilogRequestLogging: one line per request

ASP.NET Core's default request logging writes several lines per request. Serilog's middleware writes **one** event with everything:

```sql
HTTP GET /api/orders/48213 responded 200 in 38.4125 ms
  RequestMethod=GET  RequestPath=/api/orders/48213  StatusCode=200  Elapsed=38.41  UserId=907
```

Add your own fields to that single event:

```csharp
app.UseSerilogRequestLogging(options =>
{
    options.EnrichDiagnosticContext = (diagnostics, http) =>
    {
        diagnostics.Set("ClientIp", http.Connection.RemoteIpAddress?.ToString());
        diagnostics.Set("UserAgent", http.Request.Headers.UserAgent.ToString());
    };
});
```

Combined with the `Microsoft.AspNetCore: Warning` override, you get a clean log: one line per request, plus your own business events.

---

## Scopes for an operation

For context that covers **part** of a request (or a background job), use a logger scope:

```csharp
public async Task ProcessAsync(int orderId, CancellationToken ct)
{
    using var _ = _logger.BeginScope(new Dictionary<string, object> { ["OrderId"] = orderId });

    _logger.LogInformation("Generating invoice");
    await _invoices.GenerateAsync(orderId, ct);

    _logger.LogInformation("Sending confirmation");
    await _mailer.SendAsync(orderId, ct);
}
```

Both events carry `OrderId` without repeating it in every message — and so does any exception logged by the global handler while the scope is active.

---

## Sinks: where the logs go

| Sink | Good for |
|---|---|
| Console | Development; containers and cloud platforms that collect stdout |
| File (rolling, JSON) | Simple servers, a fallback when the log server is unreachable |
| **Seq** | A simple, excellent log server for .NET teams — free for individuals, query with `OrderId = 48213` |
| **Elasticsearch** (via Elastic's official Serilog sink, or JSON files shipped by an agent) | Large volumes, the Elastic stack with Kibana dashboards |
| Application Insights / cloud log services | Apps hosted on that cloud |

Run Seq locally to see the difference immediately: every property is clickable and filterable, and `select count(*) from stream where @Level = 'Error' group by RequestPath` answers "which endpoint fails most?".

---

## What NOT to log

```sql
❌ Passwords, tokens, API keys, refresh tokens, Authorization headers
❌ Full credit card numbers, national ids, health data
❌ Whole request/response bodies by default (they contain all of the above)
❌ Personal data you don't need — logs are copied, kept and read by many people
```

Logs often have weaker protection than the database and are kept for months. Log **ids** (`CustomerId=907`), not personal details (`jane@example.com`) — you can always look up the customer from the id.

---

## Performance

- **Templates are cheap when the level is off** — the event isn't even created. Interpolated strings are built anyway.
- For very hot paths, .NET's **`[LoggerMessage]` source generator** produces optimized logging methods:

```csharp
public static partial class AppLog      // not "Log": that name is Serilog's static logger
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Order {OrderId} placed by {CustomerId}")]
    public static partial void OrderPlaced(ILogger logger, int orderId, int customerId);
}

AppLog.OrderPlaced(_logger, order.Id, order.CustomerId);
```

- **Network sinks are asynchronous and batched** (Seq, Elasticsearch): a slow log server doesn't slow down requests. Files are fast; console output is the slowest — keep it modest in production.
- **Don't log in tight loops**: one summary event ("Imported 12 450 rows in 3.2 s") beats 12 450 lines.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Message templates, never `$"..."` interpolation | Properties exist only with templates |
| Same property name for the same thing everywhere | Queries work across the whole app |
| Choose levels deliberately; override framework noise to `Warning` | Readable logs, useful alerts |
| Bootstrap logger + `try/catch` + `CloseAndFlush` | Startup crashes and last events are not lost |
| Configure in appsettings, per environment | Change levels and sinks without deploying code |
| Enrich with machine, environment, app, user, correlation id | Every event has its context |
| `UseSerilogRequestLogging` | One clean event per request |
| Scopes for per-operation context | `OrderId` on every event of the operation |
| JSON files or a log server (Seq, Elasticsearch), not plain text | Search by properties, not by grep |
| Never log secrets or personal data | Logs leak more easily than databases |

>
> ## That's it & see you soon!.
>
