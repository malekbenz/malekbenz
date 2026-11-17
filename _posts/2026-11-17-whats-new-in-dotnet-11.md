---
layout: post
title: "What's new in .NET 11 - C# 15, ASP.NET Core 11 and what to upgrade"
date: 2026-11-17
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'Asp.Net']
categories: ['.Net', 'Asp.Net']
description: 'What is new in .NET 11 - C# 15, ASP.NET Core 11 and what to upgrade'
image: /images/covers/whats-new-in-dotnet-11.png
---

.NET 11 shipped on **November 10, 2026**. And on the same day, something less exciting but more urgent happened: **.NET 8 and .NET 9 stopped receiving patches**. So whether or not you care about the new features, if you have apps on `net8.0` or `net9.0`, you have an upgrade to plan. Let's go through what's new for us — web developers using ASP.NET Core, Dapper and a React front-end — with code for each feature, and finish with an upgrade checklist.

## Release & support: STS vs LTS

| Version | Type | Support ends | Status today |
|---|---|---|---|
| .NET 8 | LTS | November 10, 2026 | ❌ No more patches |
| .NET 9 | STS | November 10, 2026 | ❌ No more patches |
| .NET 10 | LTS | November 2028 | ✅ Supported |
| .NET 11 | STS (2 years) | November 2028 | ✅ Supported |

STS releases now get **two years** of support — the same end date as .NET 10 LTS. So the choice is simple:

```sql
Conservative app, few deployments a year   → .NET 10 (LTS)
You want C# 15 and the new APIs now         → .NET 11 (same support end date!)
```

> **Installing the .NET 11 SDK doesn't change your apps.** They keep their `TargetFramework` until you change it.

---

## C# 15

C# 15 is the default language version for `net11.0` projects. Everything below works without `<LangVersion>preview</LangVersion>`, except the memory safety work.

### Union types

The headline feature. A **union** is a value that is exactly **one of** a fixed list of types:

```csharp
public record OrderDto(int Id, string Status, decimal Total, string? LockedBy);
public record OrderNotFound(int Id);
public record OrderLocked(int Id, string LockedBy);

public union OrderLookup(OrderDto, OrderNotFound, OrderLocked);
```

Each case converts implicitly to the union, and the compiler checks that a `switch` handles **every** case:

```csharp
public async Task<OrderLookup> GetForEditAsync(int id)
{
    var order = await _repo.GetAsync(id);

    if (order is null)               return new OrderNotFound(id);
    if (order.LockedBy is { } user)  return new OrderLocked(id, user);
    return order;
}

app.MapGet("/api/orders/{id:int}/edit", async (int id, OrderService service) =>
    await service.GetForEditAsync(id) switch
    {
        OrderDto order     => Results.Ok(order),
        OrderNotFound      => Results.NotFound(),
        OrderLocked locked => Results.Conflict(new { locked.LockedBy }),
    });
```

No exceptions for normal business outcomes, no `null` that means three different things, and if you add a fourth case to the union, every `switch` that forgot it gets a warning. Before C# 15, we wrote this with libraries like `OneOf` or with base classes — now it's in the language.

### Closed hierarchies

When the cases are **classes of the same family**, mark the base class `closed`: it can only be derived inside its own assembly, so the compiler knows all the subclasses:

```csharp
public closed record PaymentState;
public record Pending : PaymentState;
public record Paid(DateTime At) : PaymentState;
public record Refunded(decimal Amount) : PaymentState;

string Describe(PaymentState state) => state switch
{
    Pending          => "waiting",
    Paid(var at)     => $"paid on {at:d}",
    Refunded(var a)  => $"refunded {a}",
    // no default arm needed — all direct descendants are handled
};
```

A `closed` class is implicitly abstract. Use unions for "one of unrelated types", closed hierarchies for "one of my own subclasses".

### Collection expression arguments

Collection expressions (`[...]`) can now pass arguments to the collection's constructor with `with(...)`:

```csharp
// A case-insensitive set, in one expression
HashSet<string> tags = [with(StringComparer.OrdinalIgnoreCase), "Urgent", "urgent", "VIP"];
// tags.Count == 2

// A list with the right capacity from the start
List<OrderDto> page = [with(capacity: pageSize), .. firstOrders];
```

### Extension indexers, labeled break and continue

Extension blocks (C# 14) can now declare **indexers**:

```csharp
public static class ConfigExtensions
{
    extension(IConfiguration config)
    {
        public int this[string key, int defaultValue] => config.GetValue(key, defaultValue);
    }
}

int interval = configuration["Import:IntervalSeconds", 60];
```

And `break` / `continue` can target an outer loop by its label — no more boolean flags:

```csharp
outer: foreach (var file in files)
{
    foreach (var line in File.ReadLines(file))
    {
        if (line.StartsWith("#SKIP")) continue outer;   // next file
        if (line.StartsWith("#STOP")) break outer;      // stop everything
        Process(line);
    }
}
```

---

## ASP.NET Core 11

### Async validation

DataAnnotations validators can finally **await**. The classic case: "this email is already used" needs the database:

```csharp
public sealed class UniqueCustomerEmailAttribute : AsyncValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context) =>
        throw new InvalidOperationException("Use IsValidAsync.");

    protected override async Task<ValidationResult?> IsValidAsync(
        object? value, ValidationContext context, CancellationToken cancellationToken)
    {
        if (value is not string email)
            return ValidationResult.Success;

        var db = context.GetRequiredService<IDbConnectionFactory>();
        using var connection = db.Create();

        var exists = await connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            "SELECT CAST(COUNT(1) AS BIT) FROM Customers WHERE Email = @Email",
            new { Email = email }, cancellationToken: cancellationToken));

        return exists ? new ValidationResult("This email is already registered.") : ValidationResult.Success;
    }
}

public record CreateCustomerRequest(
    [Required] string Name,
    [Required, EmailAddress, UniqueCustomerEmail] string Email);
```

```csharp
builder.Services.AddValidation();

app.MapPost("/api/customers", (CreateCustomerRequest request) => Results.Created());
```

The request is validated — including the database check — **before** your endpoint runs, and an invalid request gets a standard validation `ProblemDetails` response. For rules that need several properties, implement `IAsyncValidatableObject`.

### Unions in JSON bodies + OpenAPI 3.2 (breaking!)

C# unions work in Minimal API and MVC request and response bodies. In OpenAPI, they're described with `anyOf`, one schema per case — so your generated TypeScript client for the React app gets a proper union type too.

But pay attention: **OpenAPI documents are now generated as OpenAPI 3.2 by default**, and `Microsoft.AspNetCore.OpenApi` now depends on `Microsoft.OpenApi` 3.x, which has breaking changes. If your API gateway, client generator or contract tests don't understand 3.2 yet, pin the version:

```csharp
builder.Services.AddOpenApi(options =>
{
    options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_1;
});
```

### SignalR: refresh the token without reconnecting

In the [SignalR + React post](/blog/2025/10/08/realtime-signalr-react-hooks), the JWT was sent when connecting. When it expired, the only options were to keep a connection with an expired identity or to reconnect. Now the client can **re-authenticate on the open connection**:

```csharp
app.MapHub<OrdersHub>("/hubs/orders", options =>
{
    options.EnableAuthenticationRefresh = true;
    options.CloseOnAuthenticationExpiration = true;   // no refresh in time → connection closed
});
```

```js
const connection = new HubConnectionBuilder()
  .withUrl('/hubs/orders', { accessTokenFactory: () => getAccessToken() })
  .withAuthenticationRefresh({
    enableAutoRefresh: true,
    refreshBeforeExpirationInMilliseconds: 120_000,   // 2 minutes before expiry
  })
  .withAutomaticReconnect()
  .build();

connection.onAuthenticationRefreshFailed((context) => console.error(context.error));
```

With `CloseOnAuthenticationExpiration`, a user whose session was revoked doesn't keep receiving messages on an old connection. A real security improvement for long-lived dashboards.

### Blazor, in short

`CacheView` caches the rendered output of a component subtree in static SSR, inactive tabs can pause their circuit, and static SSR forms get client-side validation. If you use React for the front-end, you can skip this part — but it's worth knowing Blazor keeps moving fast.

---

## Libraries

### Zstandard compression

Zstandard (zstd) is now built into `System.IO.Compression`, next to GZip and Brotli. It's usually much faster than GZip at a similar or better ratio — great for exports, archives and data sent between services:

```csharp
await using var output = File.Create("orders-export.json.zst");
await using var zstd = new ZstandardStream(output, CompressionLevel.Optimal);
await JsonSerializer.SerializeAsync(zstd, orders);
```

Also in this area: `ZipArchive` now **validates the CRC32** of entries. A corrupted ZIP that was silently accepted before now throws `InvalidDataException` — good, but check your import code if you accept ZIP uploads.

### LINQ FullJoin

LINQ had `Join` (inner) and `LeftJoin`/`RightJoin` (.NET 10). Now `FullJoin` keeps unmatched elements from **both** sides — perfect for "compare two lists" reports:

```csharp
// Stock in the database vs stock counted in the warehouse file
var report = dbStock.FullJoin(
    countedStock,
    db => db.ProductCode,
    counted => counted.ProductCode);

foreach (var (db, counted) in report)
{
    var code = db?.ProductCode ?? counted!.ProductCode;
    Console.WriteLine($"{code}: system={db?.Quantity ?? 0}, counted={counted?.Quantity ?? 0}");
}
```

EF Core 11 translates it to a SQL `FULL OUTER JOIN` on providers that support it.

### Running a process in one call

```csharp
ProcessTextOutput result = await Process.RunAndCaptureTextAsync("git", ["status", "--porcelain"]);

Console.WriteLine(result.StandardOutput);
Console.WriteLine($"Exit code: {result.ExitStatus.ExitCode}");
```

No more `ProcessStartInfo` + `RedirectStandardOutput` + reading both streams without deadlocking.

### In-memory stream adapters

When an API wants a `Stream` but you have memory or a string:

```csharp
using Stream body = new ReadOnlyMemoryStream(payload);        // ReadOnlyMemory<byte> → Stream, no copy
using Stream text = new StringStream(jsonText, Encoding.UTF8); // string → Stream, no byte[] first
```

Also new: `WritableMemoryStream` (over a `Memory<byte>`) and `ReadOnlySequenceStream` (over a `ReadOnlySequence<byte>` from pipelines). If you liked the [Span post](/blog/2026/03/11/csharp-span-what-where-when), these are the same idea: wrap, don't copy.

---

## EF Core 11

EF Core 11 **requires .NET 11** — if you upgrade EF, you upgrade the runtime too.

- Fewer unnecessary joins in generated SQL, better `GroupBy` translation.
- `FullJoin` translated to SQL.
- Complex types and JSON columns now work with TPT and TPC inheritance.
- **Experimental:** SQL Server vector indexes and approximate vector search.

---

## SDK & runtime

| Change | What it means for you |
|---|---|
| Native AOT CLI host + warm MSBuild server by default | `dotnet build` / `dotnet run` start faster |
| `dotnet watch` + Aspire app host | Hot reload across the whole Aspire app |
| `dotnet new mcpserver` | A template for MCP servers (tools for AI agents) |
| NuGet minimum package age | Refuse packages published too recently (supply-chain protection) |
| `dotnetup` (public preview) | Install / update SDKs per user |
| JIT, NativeAOT, `Half` (FP16) improvements | Faster, with no code change |
| **Minimum CPU: x86-64-v2** | Very old x64 machines (pre ~2013) can't run .NET 11 |
| Runtime Async (opt-in) | The runtime handles `async`/`await` itself: cleaner stack traces, less overhead |

Runtime Async is the most interesting long-term change: the .NET libraries themselves are already compiled with it. To try it in your app:

```xml
<PropertyGroup>
  <TargetFramework>net11.0</TargetFramework>
  <Features>runtime-async=on</Features>
</PropertyGroup>
```

Live stack traces in the debugger and profilers show your **real** methods instead of state-machine frames. Measure before turning it on in production.

The CPU change sounds scary, but `x86-64-v2` is what Windows 11 already requires. Check the old on-premises servers and industrial PCs, though — if one is too old, the app fails at startup with *"The current CPU is missing one or more of the baseline instruction sets"*.

---

## Upgrade checklist (from .NET 8 / 9 / 10)

```sql
1. Decide: .NET 10 (LTS) or .NET 11 (STS) — same support end date (Nov 2028)
2. Update global.json (if you pin the SDK) and the CI images
3. <TargetFramework>net11.0</TargetFramework> (or net10.0)
4. Update Microsoft.* packages to the matching major version
5. EF Core 11? → the app must target net11.0
6. OpenAPI: check gateways / client generators with 3.2, or pin OpenApi3_1
7. Microsoft.OpenApi 3.x: fix custom document/operation transformers
8. ZIP imports: corrupted files now throw InvalidDataException
9. Old servers: check the CPU supports x86-64-v2
10. Read the breaking changes list, run all tests, deploy to staging first
```

From .NET 8, also read the .NET 9 and .NET 10 breaking changes — you're jumping several versions at once.

---

## Key rules to remember

| Rule | Why |
|---|---|
| .NET 8 and 9 are out of support since Nov 10, 2026 | No more security patches — plan the upgrade now |
| .NET 10 and 11 are both supported until Nov 2028 | Pick 11 if you want the new features, 10 if you want LTS |
| Use unions for business results (found / not found / locked) | Exhaustive `switch`, no exceptions for normal outcomes |
| `closed` base classes for your own state families | The compiler knows all subclasses |
| `AsyncValidationAttribute` + `AddValidation()` | Database checks before the endpoint runs |
| OpenAPI 3.2 is the default — pin 3.1 if your tools need it | Breaking change for gateways and generators |
| Turn on SignalR authentication refresh for long connections | Expired or revoked sessions don't stay connected |
| `ZstandardStream` for fast compression | Built-in, faster than GZip |
| EF Core 11 needs .NET 11 | Plan both upgrades together |
| Check old servers for x86-64-v2 | .NET 11 refuses to start on older CPUs |

>
> ## That's it & see you soon!.
>
