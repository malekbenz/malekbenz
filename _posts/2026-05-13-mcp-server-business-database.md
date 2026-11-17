---
layout: post
title: "An MCP server over your business database - HTTP, Dapper and tools the model uses correctly"
date: 2026-05-13
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'AI', 'MCP', 'Dapper']
categories: ['.Net', 'AI']
description: 'An MCP server over your business database - HTTP, Dapper and tools the model uses correctly'
image: /images/covers/mcp-server-business-database.png
---

The demo was impressive: "show me the orders of last week that are still not shipped", and the assistant answered with a neat table. Then real users tried it. The model sent order `1042` as a **number** when our ids are strings like `ORD-1042`, so nothing was found. It filtered by status `3` instead of `Packed`. It asked for all 80,000 orders at once. And when it changed something, our tool answered `true` — which told it nothing. In [the first post](/blog/2026/04/08/first-mcp-server-in-csharp) we built a local stdio server; this time it's an **HTTP** MCP server over a real database with Dapper — and most of the work is not the plumbing, it's designing tools that a **model** uses correctly.

## The core idea: tools are an API for a model

You know how to design a REST API for developers: they read the docs, they handle errors, they page through results. A model is a very different client:

| A developer | A model |
|---|---|
| Reads the docs once, remembers them | Reads **only** names, descriptions and schemas, every time |
| Knows `ORD-1042` is a string | Guesses from the name and examples |
| Handles a 500-row page fine | Every row costs context; huge results crowd out the conversation |
| Understands `true` from context | Needs results that say what happened |
| Is trusted (somewhat) | Will try things — and can be manipulated by user input |

> **Design MCP tools like an API for a smart, literal-minded new colleague who has never seen your system and only reads the labels.**

---

## HTTP transport

```sql
dotnet new web -n Malekbenz.Mcp
dotnet add Malekbenz.Mcp package ModelContextProtocol.AspNetCore
dotnet add Malekbenz.Mcp package Dapper
dotnet add Malekbenz.Mcp package Microsoft.Data.SqlClient
```

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<IDbConnectionFactory, SqlConnectionFactory>();
builder.Services.AddScoped<IOrderRepository, OrderRepository>();     // your existing repositories

builder.Services
    .AddMcpServer()
    .WithHttpTransport()                 // Streamable HTTP
    .WithToolsFromAssembly();

var app = builder.Build();

app.MapMcp("/mcp");                      // the endpoint hosts connect to: https://shop-mcp.example.com/mcp

app.Run();
```

It's a normal ASP.NET Core app: configuration, logging, DI, health checks, authentication (the August post is about security — an HTTP MCP server on `0.0.0.0` with no auth, as in my first prototype, is a server anyone on the network can query). Hosts connect with the URL instead of starting a process:

```json
{
  "servers": {
    "shop": { "type": "http", "url": "https://shop-mcp.example.com/mcp" }
  }
}
```

### Reusing your data layer

The tools don't need a new data access layer — inject the repositories you already have (scoped services get one scope per request):

```csharp
[McpServerToolType]
public sealed class OrderTools(IOrderRepository orders, ILogger<OrderTools> logger)
{
    // tools below
}
```

That's one of the nicest things about MCP in .NET: an "AI interface" to your system is a thin layer over code you already trust.

---

## Designing tool parameters

### String ids: say it, and show the format

```csharp
[McpServerTool(ReadOnly = true)]
[Description("Gets one order with its lines and its status history. Use it when the user gives an order number.")]
public async Task<OrderDetails> GetOrder(
    [Description("Order number, a string like 'ORD-1042' (always with the 'ORD-' prefix)")] string orderNumber,
    CancellationToken ct)
{
    var normalized = NormalizeOrderNumber(orderNumber);            // accept "1042", "ord-1042", "ORD-1042"
    return await orders.GetDetailsAsync(normalized, ct)
        ?? throw new McpException($"No order '{normalized}'. Order numbers look like 'ORD-1042'. Use search_orders to find it.");
}

private static string NormalizeOrderNumber(string value)
{
    var digits = new string(value.Where(char.IsDigit).ToArray());
    return $"ORD-{digits}";
}
```

In my server, the model kept turning string ids into numbers. I first fixed it by adding a sentence to the system prompt ("ids are strings, not numbers"). That works for one host — but a tool should be correct **whatever** host and prompt uses it. Put the format in the **parameter description**, and be **tolerant** in what you accept.

### Enums as names, not numbers

A C# enum is serialized as a **number** by default, so the schema says "integer" and the model sends `3`:

```csharp
[JsonConverter(typeof(JsonStringEnumConverter<OrderStatus>))]
public enum OrderStatus { New, Paid, Packed, Shipped, Delivered, Cancelled, Returned }
```

With the string converter, the tool schema lists the allowed **names** (`"New"`, `"Paid"`, ...) — the model picks valid values, and results are readable (`"status": "Packed"` instead of `"status": 2`). A separate "list all statuses" tool (I had one) becomes unnecessary.

### Request objects vs flat parameters

```csharp
[McpServerTool(ReadOnly = true)]
[Description("Searches orders. Combine filters to narrow results; returns at most 'pageSize' orders and the total count.")]
public async Task<OrderPage> SearchOrders(
    [Description("Filter by status; omit for all statuses")] OrderStatus? status = null,
    [Description("Customer name or part of it")] string? customer = null,
    [Description("Only orders created on or after this date, 'yyyy-MM-dd'")] DateOnly? from = null,
    [Description("Only orders created before this date, 'yyyy-MM-dd'")] DateOnly? to = null,
    [Description("Page number, starting at 1")] int page = 1,
    [Description("Orders per page, 1 to 25")] int pageSize = 10,
    CancellationToken ct = default)
{
    pageSize = Math.Clamp(pageSize, 1, 25);
    page = Math.Max(page, 1);
    return await orders.SearchAsync(new OrderSearch(status, customer, from, to, page, pageSize), ct);
}
```

Both work — a tool can take one request object. But **flat optional parameters** with their own descriptions give the model the clearest schema: each filter is documented where it's used, and optional means "leave it out". Keep request objects for genuinely nested input.

---

## Paging and limits

A result of 500 orders isn't helpful: it fills the model's context, costs tokens, and buries the answer. Return **small pages** with the total:

```csharp
public sealed record OrderPage(
    int TotalCount,
    int Page,
    int PageSize,
    bool HasMore,
    IReadOnlyList<OrderSummary> Orders,
    string? Hint);

// In the repository / tool:
Hint = total > 100
    ? $"{total} orders match. Ask the user to narrow the search (status, dates, customer) instead of paging through all of them."
    : null;
```

- A **summary** type for lists (number, date, customer, status, total) — details only from `get_order`.
- A **maximum page size**, enforced on the server.
- A **hint** in the result: models follow such instructions well, and it avoids 40 calls to read 400 rows.

---

## Business rules: in tools and results, not only the prompt

My first host had a long system prompt describing the business: which statuses exist, which transitions are allowed, what each means. It worked... in that host only, and the model still tried invalid transitions. Rules belong **where the action happens**:

```csharp
[McpServerTool(Destructive = false, Idempotent = true)]
[Description("""
    Changes the status of an order. Allowed transitions:
    New → Paid or Cancelled; Paid → Packed or Cancelled; Packed → Shipped; Shipped → Delivered; Delivered → Returned.
    Cancelled and Returned are final. Check the current status with get_order first.
    """)]
public async Task<StatusChangeResult> ChangeOrderStatus(
    [Description("Order number like 'ORD-1042'")] string orderNumber,
    [Description("The new status")] OrderStatus newStatus,
    CancellationToken ct)
{
    var order = await orders.GetAsync(NormalizeOrderNumber(orderNumber), ct)
        ?? throw new McpException($"No order '{orderNumber}'.");

    if (!OrderRules.CanMove(order.Status, newStatus))
        return new StatusChangeResult(false, order.Number, order.Status, order.Status,
            $"Not allowed: {order.Status} → {newStatus}. Allowed next statuses: {string.Join(", ", OrderRules.Next(order.Status))}.");

    await orders.UpdateStatusAsync(order.Number, newStatus, ct);
    return new StatusChangeResult(true, order.Number, order.Status, newStatus, "Status changed.");
}
```

The description tells the model the rules **before** it calls; the server **enforces** them anyway (the model may ignore the description); and the result explains what to do next. The domain logic (`OrderRules`) is the same code your web API uses.

---

## Results instead of `true`

```csharp
// ❌ What does the model do with this?
public async Task<bool> UpdateCustomerName(int id, string name) { ... return true; }

// ✅ What happened, to what, and what it looks like now
public sealed record UpdateResult(bool Success, string Entity, string Id, string Message, object? Current);
```

Models summarize results for the user. "Updated customer CUS-0091: name changed from 'Durand SARL' to 'Durand & Fils'" can be repeated faithfully; `true` invites the model to invent the details.

And for errors, the same rule as last month: an `McpException` with a message that says **what was wrong and how to fix it** ("Use search_orders to find it", "Allowed next statuses: ..."). Models recover remarkably well from good error messages.

---

## Read vs write tools

Reading is safe; writing changes your business. Mark the difference — MCP has **tool annotations** for it, and hosts use them (for example, to ask the user for confirmation before a destructive call):

```csharp
[McpServerTool(ReadOnly = true)]                                  // search_orders, get_order
[McpServerTool(ReadOnly = false, Idempotent = true)]              // change_order_status
[McpServerTool(ReadOnly = false, Destructive = true)]             // delete_draft_order
```

Annotations are **hints**, not security: a host may ignore them. Real protection is on the server — and often the simplest is to **split**:

```sql
shop-mcp-read   → only read-only tools, available to everyone who may see the data
shop-mcp-admin  → write tools, for a small group, with stronger authentication (see August)
```

Start with read-only tools. You'll learn a lot about how people use the assistant before giving it the power to change anything.

---

## Logging every tool call

You want to know what the model did, for whom, with which arguments — for debugging, for audits, and to improve your descriptions:

```csharp
public async Task<StatusChangeResult> ChangeOrderStatus(string orderNumber, OrderStatus newStatus, CancellationToken ct)
{
    using var _ = logger.BeginScope(new Dictionary<string, object>
    {
        ["Tool"] = "change_order_status",
        ["OrderNumber"] = orderNumber,
        ["NewStatus"] = newStatus,
    });
    logger.LogInformation("Tool called");
    // ...
}
```

With [structured logging](/blog/2024/06/12/structured-logging-dotnet-serilog), "which tools fail most?" and "which arguments does the model get wrong?" become queries. Reviewing failed calls every week is the best way to improve descriptions: almost every repeated mistake points to a missing sentence.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Tools are an API for a model that reads only labels | Names, descriptions and schemas are everything |
| `WithHttpTransport()` + `MapMcp("/mcp")`, reuse your repositories | A thin AI layer over trusted code |
| Formats and examples in parameter descriptions; normalize input | Models guess formats (ids!) |
| Enums with `JsonStringEnumConverter` | The schema lists names, results are readable |
| Flat optional parameters for filters | The clearest schema for the model |
| Small pages, a total, a max size, a "narrow down" hint | Context is precious |
| Business rules in descriptions AND enforced on the server | Correct in every host, safe when ignored |
| Return what happened, not `true` | The model reports facts instead of inventing them |
| Actionable error messages | Models fix their calls |
| ReadOnly / Destructive annotations, separate read and write servers | Hints for hosts, real separation for safety |
| Log every call with structured properties | Debugging, audit, and better descriptions |

>
> ## That's it & see you soon!.
>
