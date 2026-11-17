---
layout: post
title: "What's new in .NET 7 and C# 11 - The features you'll actually use"
date: 2022-12-14
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'Asp.Net']
categories: ['.Net', 'Asp.Net']
description: 'What is new in .NET 7 and C# 11 - The features you will actually use'
image: /images/covers/whats-new-in-dotnet-7-csharp-11.png
---

.NET 7 was released on November 8, 2022, with C# 11, ASP.NET Core 7 and EF Core 7. The announcement lists hundreds of improvements; most of us will use a dozen of them every day. This post picks those — the ones that remove boilerplate in real web applications — with a short example for each, and starts with the question everybody asks first: should you upgrade from .NET 6?

## .NET 7 or stay on .NET 6?

| Version | Type | Support ends |
|---|---|---|
| .NET 6 | **LTS** (Long Term Support, 3 years) | November 2024 |
| .NET 7 | **STS** (Standard Term Support, 18 months) | May 2024 |
| .NET 8 | LTS (planned) | November 2026 |

.NET 7 is supported for a **shorter** time than .NET 6. The usual rule:

```sql
Products with few deployments a year, strict upgrade processes  → stay on .NET 6 (LTS), jump to .NET 8
Teams that deploy often and want the new features now           → .NET 7, then .NET 8 next year
```

Upgrading from 6 to 7 is usually easy: change `<TargetFramework>` to `net7.0`, update the `Microsoft.*` packages, build, run the tests. Most apps also get **faster for free** — .NET 7 has another big round of runtime and JIT performance work.

> **You can use C# 11 only when targeting .NET 7.** That's often the real reason to upgrade.

---

## C# 11

### required members

Before C# 11, an object initializer could silently forget a property:

```csharp
public class CreateCustomerRequest
{
    public required string Name { get; init; }
    public required string Email { get; init; }
    public string? Phone { get; init; }
}

var request = new CreateCustomerRequest { Name = "Hélène" };
// ❌ CS9035: Required member 'CreateCustomerRequest.Email' must be set in the object initializer
```

`required` makes the compiler check it. It's the cleanest answer to the nullable warnings we saw with .NET 6 ("non-nullable property must contain a non-null value") for DTOs and options classes — no more `= null!` everywhere.

### Raw string literals

JSON, SQL and regexes inside C# strings used to be full of `\"` and `\\`. With **three quotes**, everything inside is literal:

```csharp
var sql = """
    SELECT Id, Name, Email
    FROM Customers
    WHERE Email LIKE '%@example.com'
    ORDER BY Name
    """;

var json = """
    { "name": "Hélène", "tags": ["vip", "newsletter"] }
    """;
```

The indentation of the closing `"""` is removed from every line, so the string stays nicely aligned with your code. Interpolation works too; when the text itself contains braces (JSON), you use **two** `$` and double braces for the holes:

{% raw %}
```csharp
var payload = $$"""
    { "customerId": {{customerId}}, "status": "{{status}}" }
    """;
```
{% endraw %}

### List patterns

Pattern matching now works on **arrays and lists**:

```csharp
string Describe(string[] args) => args switch
{
    []                       => "No command",
    ["help"]                 => "Show help",
    ["run", var target]      => $"Run {target}",
    ["run", var target, ..]  => $"Run {target} with options",
    [var first, .., var last] => $"From {first} to {last}",
    _                        => "Unknown command",      // e.g. a single unknown word
};

if (orderStatuses is [.., "Cancelled"])
    Console.WriteLine("The last status is Cancelled");
```

`..` matches any number of elements (the "slice" pattern). Very handy for parsing command-line arguments, CSV lines or small protocols.

### Smaller ones: generic attributes, UTF-8 literals, file-local types

```csharp
// Generic attributes: no more typeof() in attributes
public class ValidatorAttribute<T> : Attribute where T : IValidator { }

[Validator<CreateOrderValidator>]
public class CreateOrderRequest { /* ... */ }

// UTF-8 string literals: a ReadOnlySpan<byte>, with no allocation and no encoding at runtime
ReadOnlySpan<byte> header = "Content-Type"u8;

// file-local types: visible only in this file (useful for source generators and helpers)
file class InternalHelper { }
```

### Generic math

Interfaces can now declare **static abstract** members, and .NET 7 uses this to describe numbers: `INumber<T>`, `IAdditionOperators<...>`... You can finally write one method for `int`, `decimal`, `double`:

```csharp
static T Sum<T>(IEnumerable<T> values) where T : INumber<T>
{
    T total = T.Zero;
    foreach (var value in values)
        total += value;
    return total;
}

Sum(new[] { 1, 2, 3 });            // 6 (int)
Sum(new[] { 1.5m, 2.25m });        // 3.75 (decimal)
```

Most application code won't define such interfaces, but libraries (and your own utility methods) benefit a lot.

---

## ASP.NET Core 7

### Minimal APIs grow up: route groups, filters, typed results

In .NET 6, minimal APIs were great for small services but lacked structure. .NET 7 fills the gaps:

```csharp
var orders = app.MapGroup("/api/orders")          // shared prefix
                .RequireAuthorization()            // shared auth
                .WithTags("Orders");               // shared OpenAPI tag

orders.MapGet("/{id:int}", async Task<Results<Ok<OrderDto>, NotFound>> (int id, IOrderService service) =>
    await service.GetAsync(id) is { } order ? TypedResults.Ok(order) : TypedResults.NotFound());

orders.MapPost("/", async (CreateOrderRequest request, IOrderService service) =>
{
    var order = await service.CreateAsync(request);
    return TypedResults.Created($"/api/orders/{order.Id}", order);
})
.AddEndpointFilter<ValidationFilter<CreateOrderRequest>>();   // runs before the handler
```

- **`MapGroup`**: a prefix and settings shared by many endpoints.
- **Endpoint filters**: code before/after a handler — validation, logging — like MVC action filters.
- **`TypedResults` + `Results<T1, T2>`**: the possible responses are part of the signature, so OpenAPI documents them and unit tests can check them.

### Rate limiting

Built in, at last:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("api", o =>
    {
        o.PermitLimit = 100;                       // 100 requests...
        o.Window = TimeSpan.FromMinutes(1);        // ...per minute
    });
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;   // default is 503
});

app.UseRateLimiter();

orders.RequireRateLimiting("api");
```

Fixed window, sliding window, token bucket and concurrency limiters are all available — perfect for login endpoints and public APIs.

### Output caching

The [caching post](/blog/2022/05/11/aspnet-core-caching-memory-redis) cached **data**; output caching caches the **whole response** on the server:

```csharp
builder.Services.AddOutputCache();
app.UseOutputCache();

app.MapGet("/api/categories", GetCategories).CacheOutput(p => p.Expire(TimeSpan.FromMinutes(10)));
```

Unlike the older response caching, the server decides (not the browser's headers), and you can invalidate entries by **tag**. By default it doesn't cache authenticated requests — a safe default against the "user B sees user A's data" bug.

### Problem details everywhere

```csharp
builder.Services.AddProblemDetails();
```

Errors from the framework (404s, unhandled exceptions with the exception handler, status code pages) now use the standard `application/problem+json` format — one error shape for your front-end.

---

## EF Core 7

### ExecuteUpdate and ExecuteDelete

Updating thousands of rows used to mean loading them all, changing them, and `SaveChanges`. Now, one SQL statement:

```csharp
await db.Orders
    .Where(o => o.Status == "New" && o.CreatedAt < cutoff)
    .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, "Expired"));

await db.Carts
    .Where(c => c.UpdatedAt < DateTime.UtcNow.AddDays(-30))
    .ExecuteDeleteAsync();
```

```sql
UPDATE [o] SET [o].[Status] = N'Expired' FROM [Orders] AS [o] WHERE [o].[Status] = N'New' AND [o].[CreatedAt] < @cutoff
```

No entities loaded, no change tracking — the cleanup job from the [background services post](/blog/2022/06/08/aspnet-core-background-services-channels) becomes one line. (These bypass the change tracker: entities already loaded in the context don't see the change.)

### JSON columns and more

```csharp
modelBuilder.Entity<Customer>().OwnsOne(c => c.Preferences, b => b.ToJson());
// Preferences is stored as JSON in one nvarchar column — and can be queried with LINQ
```

Also: **TPC** inheritance mapping (one table per concrete type), and faster `SaveChanges` (fewer round trips, smarter batching).

---

## Libraries

```csharp
// Regex source generator: the regex is compiled at BUILD time — faster, and checked by the compiler
public static partial class Patterns
{
    [GeneratedRegex(@"^[A-Z]{3}-\d{4}$")]
    public static partial Regex OrderReference();
}

Patterns.OrderReference().IsMatch("ORD-1042");   // true
```

```csharp
// System.Text.Json polymorphism: serialize a base type with a type discriminator
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(CardPayment), "card")]
[JsonDerivedType(typeof(TransferPayment), "transfer")]
public abstract class Payment { public decimal Amount { get; set; } }

public class CardPayment : Payment { public string Last4 { get; set; } = ""; }
public class TransferPayment : Payment { public string Iban { get; set; } = ""; }

// { "type": "card", "last4": "4242", "amount": 120 }  ⇄  CardPayment
```

---

## A year of .NET on this blog

This post closes 2022. Here's the path we took:

| Month | Post |
|---|---|
| January | [.NET 6 minimal hosting](/blog/2022/01/12/dotnet-6-minimal-hosting-startup-to-program) |
| February | [Dependency injection lifetimes](/blog/2022/02/09/dotnet-dependency-injection-lifetimes) |
| March | [async/await in C#](/blog/2022/03/09/csharp-async-await-explained) |
| April | [HttpClientFactory & typed clients](/blog/2022/04/13/dotnet-httpclient-factory-typed-clients) |
| May | [Caching: IMemoryCache & Redis](/blog/2022/05/11/aspnet-core-caching-memory-redis) |
| June | [Background services & Channels](/blog/2022/06/08/aspnet-core-background-services-channels) |
| July | [Testing: xUnit, Moq, WebApplicationFactory](/blog/2022/07/13/testing-aspnet-core-xunit-moq-webapplicationfactory) |
| August | [SQL Server CTEs & window functions](/blog/2022/08/10/sqlserver-ctes-window-functions) |
| September | [gRPC in .NET](/blog/2022/09/14/grpc-in-dotnet) |
| October | [Git branching & pull requests](/blog/2022/10/12/git-branching-and-pull-requests) |
| November | [Messaging with RabbitMQ](/blog/2022/11/09/rabbitmq-messaging-in-dotnet) |
| December | .NET 7 & C# 11 (this post) |

---

## Key rules to remember

| Rule | Why |
|---|---|
| .NET 7 is STS (18 months), .NET 6 is LTS | Choose by how often you can upgrade |
| C# 11 needs `net7.0` | Often the real reason to move |
| `required` members for DTOs and options | The compiler checks initializers, fewer `null!` |
| Raw string literals for SQL, JSON, regex | No more escaping |
| List patterns for arrays and lists | Readable parsing of arguments and lines |
| `MapGroup`, endpoint filters, `TypedResults` | Minimal APIs ready for bigger apps |
| Built-in rate limiting (set 429) | Protect logins and public endpoints |
| Output caching for whole responses, tag invalidation | Server-side, safe defaults |
| `ExecuteUpdate` / `ExecuteDelete` for bulk changes | One SQL statement, no tracking |
| `[GeneratedRegex]`, STJ polymorphism | Faster regexes, clean type hierarchies in JSON |

>
> ## That's it & see you soon!.
>
