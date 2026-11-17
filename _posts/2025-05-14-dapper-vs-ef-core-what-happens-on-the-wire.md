---
layout: post
title: "Dapper vs EF Core - What really happens on the wire"
date: 2025-05-14
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'SQL', 'SQLSERVER']
categories: ['.Net', 'SQLSERVER']
description: 'Dapper vs EF Core - What really happens on the wire'
image: /images/covers/dapper-vs-ef-core-what-happens-on-the-wire.png
---

Every .NET team has this debate: "EF Core is too slow, use Dapper" — "Dapper is too much SQL, use EF Core". Most of the time both sides are guessing. Let's stop guessing and look at what each one really sends to SQL Server, what it costs in your application, and when each one is the right tool.

## The core idea: micro-ORM vs full ORM

```sql
Dapper  = SQL you write  → ADO.NET → SQL Server → rows mapped to objects
EF Core = LINQ you write → translated to SQL → ADO.NET → SQL Server
          → rows mapped to entities → entities tracked for changes
```

Both use the **same ADO.NET driver** (`Microsoft.Data.SqlClient`) underneath. The difference is everything around it:

| | Dapper | EF Core |
|---|---|---|
| You write | SQL | LINQ (or raw SQL) |
| Mapping | Columns → properties | Columns → entities + relationships |
| Change tracking | ❌ None | ✅ Yes (by default) |
| Migrations | ❌ None | ✅ Built-in |
| Relationships / Include | Manual (multi-mapping) | Automatic |
| Control over the SQL | Total | Good, but it's generated |

> **Dapper is not "faster SQL". The SQL Server side is the same. The difference is the work done in your .NET process.**

---

## Setup — the model we'll use

We reuse the `Orders` table from the [indexes post](/blog/2025/03/12/sqlserver-indexes-from-the-inside), plus a `Customers` table:

```csharp
public class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<Order> Orders { get; set; } = new();
}

public class Order
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public DateTime OrderDate { get; set; }
    public string Status { get; set; } = "";
    public decimal Total { get; set; }
    public Customer? Customer { get; set; }
}

public class ShopContext : DbContext
{
    public ShopContext(DbContextOptions<ShopContext> options) : base(options) { }

    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
}
```

---

## Same query, two ways: the SQL each one sends

**Paid orders of one customer.**

### Dapper

```csharp
using var connection = new SqlConnection(connectionString);

var orders = await connection.QueryAsync<Order>(@"
    SELECT Id, CustomerId, OrderDate, Status, Total
    FROM Orders
    WHERE CustomerId = @CustomerId AND Status = 'Paid'",
    new { CustomerId = 4242 });
```

What SQL Server receives (watch it with **SQL Server Profiler** or **Extended Events**):

```sql
exec sp_executesql N'
    SELECT Id, CustomerId, OrderDate, Status, Total
    FROM Orders
    WHERE CustomerId = @CustomerId AND Status = ''Paid''',
    N'@CustomerId int', @CustomerId = 4242
```

Exactly what you wrote. Nothing more.

### EF Core

```csharp
var orders = await db.Orders
    .Where(o => o.CustomerId == 4242 && o.Status == "Paid")
    .ToListAsync();
```

To see the generated SQL without a profiler, use `ToQueryString()` or turn on logging:

```csharp
options.UseSqlServer(connectionString)
       .LogTo(Console.WriteLine, LogLevel.Information);
```

```sql
SELECT [o].[Id], [o].[CustomerId], [o].[OrderDate], [o].[Status], [o].[Total]
FROM [Orders] AS [o]
WHERE [o].[CustomerId] = 4242 AND [o].[Status] = N'Paid'
```

Two details to notice:

- The constant `4242` is **inlined** because it's a literal in the LINQ. If you use a variable, EF sends a parameter (`@__customerId_0`) — always use variables for values that change, or every value gets its own plan.
- `N'Paid'` is an **NVARCHAR** literal. If `Status` is `VARCHAR`, tell EF: `.HasColumnType("varchar(20)")` or `.IsUnicode(false)` in the model — the same implicit conversion trap we saw with Dapper's `DbString`.

For simple queries, the SQL is almost the same. The cost difference is **after** the rows come back.

---

## Connections & pooling (what Open/Dispose really do)

```csharp
using var connection = new SqlConnection(connectionString);
await connection.OpenAsync();   // takes a connection from the pool
// ...
// Dispose() → returns it to the pool, the TCP connection stays open
```

Opening a real connection to SQL Server (TCP + login) is slow. ADO.NET keeps a **pool** of open connections per connection string (100 maximum by default). `Open` and `Dispose` are cheap — so the rule is the same for both libraries:

> **Open late, close early. Never keep a connection in a static field.**

| | Dapper | EF Core |
|---|---|---|
| Who opens the connection | You (or Dapper opens/closes it for you if it's closed) | The `DbContext`, for each query |
| Lifetime | `using` block | `DbContext` is scoped (one per web request) |
| Pool exhaustion risk | Forgetting `using` | Keeping a `DbContext` alive too long |

If you see `Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool`, look for connections that are never disposed.

---

## Change tracking: the hidden cost

When EF Core loads entities, by default it **tracks** them: it keeps a snapshot of every original value to detect changes when you call `SaveChanges()`.

```csharp
var orders = await db.Orders.Where(o => o.CustomerId == 1).ToListAsync();
// 500,000 entities + 500,000 snapshots in memory
```

For a read-only page (a report, an API that returns JSON), that's pure waste. Turn it off:

```csharp
var orders = await db.Orders
    .AsNoTracking()
    .Where(o => o.CustomerId == 1)
    .ToListAsync();
```

Or project only what you need — EF doesn't track anonymous types or DTOs:

```csharp
var summaries = await db.Orders
    .Where(o => o.CustomerId == 1)
    .Select(o => new OrderSummary(o.Id, o.OrderDate, o.Status, o.Total))
    .ToListAsync();
```

With `AsNoTracking()` + projection, EF Core's read performance gets very close to Dapper's.

---

## The N+1 problem

### Scenario — list 50 customers with their orders

The classic mistake, in both libraries:

```csharp
var customers = await db.Customers.Take(50).ToListAsync();   // 1 query

foreach (var customer in customers)
{
    customer.Orders = await db.Orders                         // + 50 queries
        .Where(o => o.CustomerId == customer.Id)
        .ToListAsync();
}
```

```sql
1 query for customers + 50 queries for orders = 51 round trips
```

Each round trip costs network latency. 51 × 2 ms = 100 ms of waiting for nothing.

### EF Core: Include

```csharp
var customers = await db.Customers
    .Include(c => c.Orders)
    .Take(50)
    .AsSplitQuery()
    .ToListAsync();
```

- Without `AsSplitQuery()`: **one** query with a `JOIN` — customer columns are repeated for every order (the "cartesian explosion" when you include several collections).
- With `AsSplitQuery()`: **two** queries (customers, then their orders) — no duplication.

### Dapper: QueryMultiple

```csharp
using var connection = new SqlConnection(connectionString);

using var multi = await connection.QueryMultipleAsync(@"
    SELECT TOP (50) Id, Name FROM Customers ORDER BY Id;

    SELECT o.Id, o.CustomerId, o.OrderDate, o.Status, o.Total
    FROM Orders o
    WHERE o.CustomerId IN (SELECT TOP (50) Id FROM Customers ORDER BY Id);");

var customers = (await multi.ReadAsync<Customer>()).ToList();
var orders = (await multi.ReadAsync<Order>()).ToLookup(o => o.CustomerId);

foreach (var customer in customers)
    customer.Orders = orders[customer.Id].ToList();
```

One round trip, two result sets, and you stitch them together yourself. More code, total control.

---

## Transactions in both

### EF Core

`SaveChanges()` already wraps all its changes in **one transaction**. You only need an explicit one when you call `SaveChanges()` several times or mix in raw SQL:

```csharp
await using var transaction = await db.Database.BeginTransactionAsync();

db.Orders.Add(newOrder);
await db.SaveChangesAsync();

await db.Database.ExecuteSqlInterpolatedAsync(
    $"UPDATE Customers SET LastOrderDate = SYSDATETIME() WHERE Id = {newOrder.CustomerId}");

await transaction.CommitAsync();
```

### Dapper

You must pass the transaction to **every** command, or you get an error (`ExecuteReader requires the command to have a transaction...`):

```csharp
using var connection = new SqlConnection(connectionString);
await connection.OpenAsync();
using var transaction = connection.BeginTransaction();

var orderId = await connection.ExecuteScalarAsync<int>(@"
    INSERT INTO Orders (CustomerId, OrderDate, Status, Total)
    VALUES (@CustomerId, SYSDATETIME(), 'New', @Total);
    SELECT CAST(SCOPE_IDENTITY() AS INT);",
    new { CustomerId = 4242, Total = 99.90m }, transaction);

await connection.ExecuteAsync(
    "UPDATE Customers SET LastOrderDate = SYSDATETIME() WHERE Id = @Id",
    new { Id = 4242 }, transaction);

transaction.Commit();
```

Which isolation level should these transactions use? That's a whole story — we'll come back to it in a dedicated post.

---

## Benchmarking it yourself

Don't trust anybody's numbers (including mine) — measure with your data and your hardware. Here is a small **BenchmarkDotNet** setup:

```csharp
[MemoryDiagnoser]
public class OrmBenchmarks
{
    private const string ConnectionString = "Server=.;Database=Shop;Trusted_Connection=True;TrustServerCertificate=True";
    private ShopContext _db = null!;

    [GlobalSetup]
    public void Setup() =>
        _db = new ShopContext(new DbContextOptionsBuilder<ShopContext>()
            .UseSqlServer(ConnectionString).Options);

    [Benchmark(Baseline = true)]
    public async Task<List<Order>> Dapper_1000()
    {
        using var connection = new SqlConnection(ConnectionString);
        return (await connection.QueryAsync<Order>(
            "SELECT TOP (1000) Id, CustomerId, OrderDate, Status, Total FROM Orders")).AsList();
    }

    [Benchmark]
    public Task<List<Order>> EF_Tracking_1000() =>
        _db.Orders.Take(1000).ToListAsync();

    [Benchmark]
    public Task<List<Order>> EF_NoTracking_1000() =>
        _db.Orders.AsNoTracking().Take(1000).ToListAsync();
}
```

```sql
dotnet run -c Release
```

What you'll typically see (look at the **Ratio** and **Allocated** columns):

| Scenario | What to expect |
|---|---|
| Single row by key | All three very close — network and SQL Server dominate |
| 1,000 rows, EF with tracking | Clearly slower and allocates much more memory |
| 1,000 rows, EF `AsNoTracking` | Close to Dapper |
| Many inserts | EF batches `SaveChanges()` well; Dapper needs a bulk approach (TVP or `SqlBulkCopy`) to beat it |

---

## When to use which

| Situation | Choice | Why |
|---|---|---|
| CRUD on a rich domain model | EF Core | Change tracking, relationships, migrations |
| Read-heavy APIs, reports, dashboards | Dapper (or EF `AsNoTracking` + projection) | Less overhead, exact SQL |
| Complex SQL (CTEs, window functions, hints) | Dapper | You write it exactly as you want |
| Team is more comfortable with LINQ than SQL | EF Core | Fewer SQL mistakes |
| Bulk updates / deletes | EF `ExecuteUpdate` / `ExecuteDelete`, or Dapper | One statement, no entity loading |
| Need schema migrations in the same tool | EF Core | Dapper doesn't do schema |

---

## Using both in the same project

You don't have to choose. EF Core for writes and the domain, Dapper for the heavy reads — sharing **the same connection and transaction**:

```csharp
await using var transaction = await db.Database.BeginTransactionAsync();

db.Orders.Add(newOrder);
await db.SaveChangesAsync();

var connection = db.Database.GetDbConnection();

var stats = await connection.QuerySingleAsync<CustomerStats>(@"
    SELECT COUNT(*) AS OrderCount, SUM(Total) AS TotalSpent
    FROM Orders WHERE CustomerId = @CustomerId",
    new { newOrder.CustomerId },
    transaction.GetDbTransaction());

await transaction.CommitAsync();
```

`GetDbConnection()` gives you the underlying `SqlConnection`, and `GetDbTransaction()` the underlying `SqlTransaction` that Dapper needs.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Both use the same ADO.NET driver | The SQL Server side costs the same |
| Look at the SQL EF generates (`ToQueryString`, `LogTo`) | No surprises in production |
| Use `AsNoTracking()` or projections for reads | Tracking is the main EF overhead |
| Use variables, not constants, for changing values in LINQ | Parameters = plan reuse |
| Map `VARCHAR` columns correctly (`IsUnicode(false)`, `DbString`) | Avoids implicit conversions |
| Kill N+1 with `Include` + `AsSplitQuery` or `QueryMultiple` | One or two round trips instead of 51 |
| With Dapper, pass the transaction to every command | Otherwise the command fails |
| Measure with BenchmarkDotNet, with your data | The only numbers that matter |

>
> ## That's it & see you soon!.
>
