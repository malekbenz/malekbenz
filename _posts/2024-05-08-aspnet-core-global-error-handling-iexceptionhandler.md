---
layout: post
title: "Global error handling in ASP.NET Core 8 - IExceptionHandler and ProblemDetails"
date: 2024-05-08
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: 'Global error handling in ASP.NET Core 8 - IExceptionHandler and ProblemDetails'
image: /images/covers/aspnet-core-global-error-handling-iexceptionhandler.png
---

I searched one of my older solutions for `catch (Exception`: **229** results. And `ex.Message`: about 90, many of them going straight back to the client — `return BadRequest(ex.Message)`. So a database timeout became a **400 Bad Request** (as if the user had sent bad data), a SQL error message with table names ended up in the browser, and every action had its own idea of what an error looks like. It's a very common way for an API to grow. .NET 8 makes the alternative easy: **catch once, at the edge**, with `IExceptionHandler`, and answer with one standard format, **ProblemDetails**. Let's refactor towards it.

## The core idea: catch once, at the edge

```sql
Before: every action                          After: one place
┌──────────────────────────┐                 ┌──────────────────────────────┐
│ try { ... }              │                 │ Exception handler middleware │ ← catches everything
│ catch (Exception ex)     │                 │   NotFoundException  → 404   │
│   return BadRequest(     │                 │   ConflictException  → 409   │
│     ex.Message);  ✗      │                 │   ValidationException→ 400   │
└──────────────────────────┘                 │   anything else      → 500   │
   × 229                                     └──────────────────────────────┘
                                             actions contain only the happy path
```

> **Most code shouldn't catch exceptions at all. Let them bubble up to one handler that knows how to turn them into HTTP responses.**

---

## What's wrong with try/catch everywhere

```csharp
[HttpGet("{id}")]
public async Task<IActionResult> Get(int id)
{
    try
    {
        var order = await _orders.GetAsync(id);
        return Ok(order);
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Error");
        return BadRequest(ex.Message);        // ✗ ✗ ✗
    }
}
```

| Problem | Consequence |
|---|---|
| `ex.Message` sent to the client | Leaks internals: SQL, table names, file paths, sometimes connection details |
| Always `BadRequest` | A server bug looks like a client mistake — monitoring and clients get it wrong |
| A different error shape per action | The front-end can't handle errors in one place |
| The same 8 lines in every action | Noise, and one day someone forgets them |
| Catching and returning a `200`/`400` | The exception never reaches logging, metrics, alerts |

---

## ProblemDetails: one standard error shape

ProblemDetails is a standard (RFC 7807) JSON format for HTTP errors, built into ASP.NET Core:

```json
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not Found",
  "status": 404,
  "detail": "Order 42 was not found.",
  "instance": "GET /api/orders/42",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```

| Field | Meaning |
|---|---|
| `status` | The HTTP status code |
| `title` | A short, generic summary |
| `detail` | A message for **this** occurrence — safe to show users |
| `instance` | Which request it was |
| extensions (`traceId`, `errors`...) | Anything extra: correlation id, validation errors |

The validation responses from the [FluentValidation post](/blog/2024/04/10/fluentvalidation-aspnet-core-validate-once) already use this format (`ValidationProblemDetails` adds an `errors` dictionary). The goal: **every** error from the API looks like this.

---

## The setup: three lines

```csharp
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();      // catches unhandled exceptions → ProblemDetails (500)
app.UseStatusCodePages();       // empty 404/405/401... responses → ProblemDetails too
```

With only this:

- An unhandled exception becomes a **500** ProblemDetails — without the exception message.
- A `return NotFound();` with no body, or a route that doesn't exist, becomes a **404** ProblemDetails instead of an empty response.

Put `UseExceptionHandler()` **early** in the pipeline: it only catches exceptions from the middleware registered **after** it.

---

## IExceptionHandler: a chain of handlers

.NET 8 added `IExceptionHandler`: small classes that decide how to answer for specific exceptions. Register several; they're tried **in registration order** until one returns `true`.

### Domain exceptions

First, exceptions that **mean something** in your application:

```csharp
public abstract class AppException(string message) : Exception(message);

public sealed class NotFoundException(string resource, object key)
    : AppException($"{resource} {key} was not found.");

public sealed class ConflictException(string message) : AppException(message);

public sealed class BusinessRuleException(string message) : AppException(message);
```

Their message is written **for the user** — that's what makes it safe to return.

### The handler

```csharp
public sealed class AppExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        var (status, title) = exception switch
        {
            NotFoundException     => (StatusCodes.Status404NotFound, "Not found"),
            ConflictException     => (StatusCodes.Status409Conflict, "Conflict"),
            BusinessRuleException => (StatusCodes.Status422UnprocessableEntity, "Business rule violated"),
            _                     => (0, null),
        };

        if (status == 0)
            return false;                                   // not ours: let the next handler try

        context.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = { Status = status, Title = title, Detail = exception.Message },
        });
    }
}
```

### Validation exceptions

The MediatR validation behavior from April **throws** a FluentValidation `ValidationException`. One more handler turns it into a 400 with field errors:

```csharp
public sealed class ValidationExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is not FluentValidation.ValidationException validation)
            return false;

        var errors = validation.Errors
            .GroupBy(e => e.PropertyName)
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());

        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = new ValidationProblemDetails(errors) { Status = 400 },
        });
    }
}
```

### Registration

```csharp
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ValidationExceptionHandler>();   // tried first
builder.Services.AddExceptionHandler<AppExceptionHandler>();          // then this one
// anything left → the default: a generic 500 ProblemDetails

app.UseExceptionHandler();
```

Now the action is only the happy path:

```csharp
app.MapGet("/api/orders/{id:int}", async (int id, IOrderService orders) =>
    TypedResults.Ok(await orders.GetAsync(id)));            // GetAsync throws NotFoundException

public async Task<OrderDto> GetAsync(int id) =>
    await _repo.FindAsync(id) ?? throw new NotFoundException("Order", id);
```

### The fallback: a 500 that says nothing internal

Everything not handled — a `SqlException`, a `NullReferenceException`, a timeout — becomes:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.6.1",
  "title": "An error occurred while processing your request.",
  "status": 500,
  "traceId": "00-4bf92f35..."
}
```

No message, no stack trace, no SQL. The user sees a generic message; **you** find the details in the logs, thanks to the `traceId`.

---

## Customizing ProblemDetails

Add the same useful fields to **every** ProblemDetails — the ones from the exception handler, from `UseStatusCodePages` and from `Results.Problem(...)`:

```csharp
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = ctx =>
    {
        var http = ctx.HttpContext;
        ctx.ProblemDetails.Instance = $"{http.Request.Method} {http.Request.Path}";
        ctx.ProblemDetails.Extensions["traceId"] = Activity.Current?.Id ?? http.TraceIdentifier;
    };
});
```

The `traceId` is what support needs: a user sends a screenshot of the error, you search the logs for that id, and you find the exact exception.

---

## Logging: once, with context

The exception handler middleware already **logs** every exception that reaches it (at the `Error` level, with the stack trace and the request path). So:

```csharp
catch (Exception ex)
{
    _logger.LogError(ex, "Failed to load order");   // ✗ logged here...
    throw;                                          // ...and again by the middleware: two entries, same error
}
```

Don't log and rethrow — you get the same error twice in the logs, and twice the alerts. Let the global handler log, and add **context** with scopes when it helps:

```csharp
using (_logger.BeginScope(new Dictionary<string, object> { ["OrderId"] = id }))
{
    await _orders.ProcessAsync(id);     // if this throws, the logged error carries OrderId
}
```

One consequence: because every exception reaching the middleware is logged as an error, "order not found" exceptions add noise to error logs. That's another argument for the last section — **expected** cases are better as results than as exceptions.

---

## Development vs production

In development, seeing the exception is useful. Add it only there:

```csharp
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = ctx =>
    {
        ctx.ProblemDetails.Extensions["traceId"] = Activity.Current?.Id ?? ctx.HttpContext.TraceIdentifier;

        if (builder.Environment.IsDevelopment() && ctx.Exception is { } ex)
            ctx.ProblemDetails.Extensions["exception"] = new { ex.Message, Type = ex.GetType().Name };
    };
});
```

Never ship exception details to production clients, even "just for debugging" — that's exactly the leak we're removing.

---

## When try/catch IS right

Global handling doesn't mean `try/catch` disappears. It stays where you **do something useful** with the exception:

| Situation | Example |
|---|---|
| **Recover** | Retry a transient failure, fall back to the cache when Redis is down |
| **Clean up** | `finally` (or `using`) to release resources — no `catch` needed |
| **Translate** | Turn a low-level exception into a domain one: `SqlException 2627` (duplicate key) → `ConflictException("This email is already used.")` |
| **Isolate** | Per-message `try/catch` in a background service, so one bad message doesn't stop the loop |

```csharp
try
{
    await _db.SaveChangesAsync(ct);
}
catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2627 or 2601 })
{
    throw new ConflictException("A customer with this email already exists.");   // translate
}
```

If a `catch` only logs and returns an error, delete it — the global handler does that better.

---

## Results instead of exceptions for expected cases

"Not found" or "already exists" are **not exceptional**: they're normal outcomes of a business operation. Exceptions are slower, invisible in method signatures, and noisy in logs. For expected cases, return a result:

```csharp
app.MapGet("/api/orders/{id:int}", async Task<Results<Ok<OrderDto>, NotFound>> (int id, IOrderRepository repo) =>
    await repo.FindAsync(id) is { } order ? TypedResults.Ok(order) : TypedResults.NotFound());
```

A practical split:

```sql
Expected outcomes (not found, invalid input, rule not met)  → results / TypedResults / validation
Unexpected failures (bugs, infrastructure down)            → exceptions → global handler → 500
Domain exceptions                                           → a pragmatic middle ground for deep layers
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| Catch once, at the edge | Actions contain only the happy path |
| Never send `ex.Message` of unexpected exceptions to clients | It leaks internals |
| Server failures are 500, not 400 | Clients and monitoring must know whose fault it is |
| `AddProblemDetails` + `UseExceptionHandler` + `UseStatusCodePages` | One standard error format everywhere |
| `IExceptionHandler` per family of exceptions, in order | 404 / 409 / 422 / 400 mapped in one place |
| Domain exception messages are written for users | Safe to return in `detail` |
| Add `traceId` to every ProblemDetails | Support can find the exact log entry |
| Don't log and rethrow | The middleware already logs — no duplicates |
| Exception details only in Development | Never in production responses |
| Keep `try/catch` to recover, translate or isolate | Not just to log and return |
| Expected cases as results, not exceptions | Clearer signatures, quieter logs |

>
> ## That's it & see you soon!.
>
