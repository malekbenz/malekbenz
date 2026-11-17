---
layout: post
title: "Sql server Parameter Sniffing - Why the same query is fast, then slow"
date: 2025-04-09
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL', 'SQLSERVER']
categories: ['SQLSERVER']
description: 'Sql server Parameter Sniffing - Why the same query is fast, then slow'
image: /images/covers/sqlserver-parameter-sniffing.png
---

The report runs in 50 ms all morning, then suddenly takes 30 seconds. Nobody deployed anything, the data didn't change much, and when you run the same query in SSMS it's fast again. If this sounds familiar, you've met **parameter sniffing**. Let's reproduce it step by step, so you can recognize it and pick the right fix.

## The core idea: one cached plan for every parameter

Building an execution plan is expensive, so SQL Server does it **once** and keeps it in the **plan cache**.

When a parameterized query (or a stored procedure) runs for the first time, the optimizer:

1. **Sniffs** the value of the parameters for that first call
2. Estimates how many rows it will get with *that* value
3. Builds the best plan for *that* value
4. Caches the plan and **reuses it for every next call**, whatever the value

```sql
Call 1: @CustomerId = 4242  → plan built for "40 rows"   → cached
Call 2: @CustomerId = 1     → same plan reused, even if it returns 500,000 rows
```

> **Parameter sniffing is not a bug. It's a good feature that becomes a problem when your data is skewed.**

---

## Setup — skewed data (one huge customer)

We reuse the `Orders` table from the [indexes post](/blog/2025/03/12/sqlserver-indexes-from-the-inside) (2 million rows, ~40 orders per customer), with a simple non-covering index:

```sql
CREATE NONCLUSTERED INDEX IX_Orders_CustomerId ON Orders (CustomerId);
```

Now let's create one **huge** customer — think of a marketplace account that places orders for everybody:

```sql
UPDATE TOP (500000) Orders SET CustomerId = 1;

UPDATE STATISTICS Orders WITH FULLSCAN;
```

Our data now looks like this:

| CustomerId | Orders |
|---|---|
| 1 | ~500,000 |
| Any other | ~30 |

And a stored procedure, like the one behind our report:

```sql
CREATE OR ALTER PROCEDURE dbo.GetCustomerOrders
    @CustomerId INT
AS
BEGIN
    SELECT Id, OrderDate, Status, Total
    FROM Orders
    WHERE CustomerId = @CustomerId;
END
```

---

## Reproducing it step by step

```sql
SET STATISTICS IO, TIME ON;
```

### Small customer first → seek plan reused for the big one

```sql
EXEC dbo.GetCustomerOrders @CustomerId = 4242;
-- Plan: Index Seek + Key Lookup
-- logical reads: ~100      ✅ perfect for 30 rows

EXEC dbo.GetCustomerOrders @CustomerId = 1;
-- Same plan reused: Index Seek + Key Lookup, 500,000 times
-- logical reads: ~1,600,000  ❌ worse than reading the whole table (~14,000)
```

The plan was built for 30 rows. Doing 500,000 key lookups is a disaster.

### Big customer first → scan plan reused for small ones

Clear the plan for this procedure and run the calls in the opposite order:

```sql
EXEC sp_recompile 'dbo.GetCustomerOrders';

EXEC dbo.GetCustomerOrders @CustomerId = 1;
-- Plan: Clustered Index Scan
-- logical reads: ~14,000   ✅ right choice for 500,000 rows

EXEC dbo.GetCustomerOrders @CustomerId = 4242;
-- Same plan reused: full scan to return 30 rows
-- logical reads: ~14,000   ❌ instead of ~100
```

Same procedure, same data. The only difference is **who called it first** after the plan was created. That's why the problem appears "randomly": after a restart, a statistics update, an index rebuild, or when the plan was pushed out of memory.

### Why is it fast in SSMS?

When you copy the query into SSMS and run it with a literal value, it's not the same query text and maybe not the same `SET` options (`ARITHABORT` is ON in SSMS, OFF in most .NET apps). So SQL Server builds a **new** plan for your value — and it's fast. Your app keeps using the bad one.

---

## How to see it

### 1. Estimated vs actual rows

In the actual execution plan (**Ctrl+M**), hover over the Index Seek:

```sql
Estimated Number of Rows : 30
Actual Number of Rows    : 500000      ← a huge gap = suspicious plan
```

Right-click the `SELECT` operator → **Properties** → **Parameter List**. You'll see both values:

```sql
@CustomerId   Compiled Value: 4242   Runtime Value: 1
```

That's the proof: the plan was compiled for `4242`, and it's running for `1`.

### 2. The plan cache

```sql
SELECT  t.text,
        s.execution_count,
        s.min_logical_reads,
        s.max_logical_reads,
        s.min_elapsed_time / 1000 AS min_ms,
        s.max_elapsed_time / 1000 AS max_ms
FROM sys.dm_exec_query_stats s
CROSS APPLY sys.dm_exec_sql_text(s.sql_handle) t
WHERE t.text LIKE '%FROM Orders%'
ORDER BY s.max_logical_reads DESC;
```

A big difference between `min_logical_reads` and `max_logical_reads` for the same query is a typical sign of sniffing.

---

## The fixes, compared

| Fix | How it works | Cost | Use when |
|---|---|---|---|
| `OPTION (RECOMPILE)` | New plan on every call | CPU for each compile | Query runs rarely, or data is very skewed |
| `OPTIMIZE FOR (@p = value)` | Always builds the plan for one chosen value | Bad for the other values | You know the "typical" value |
| `OPTIMIZE FOR UNKNOWN` | Uses the average density, ignores the value | Average plan for everybody | You want stable, predictable plans |
| Query Store forced plan | Pins a known good plan | Needs monitoring | Production fire, no code change possible |
| PSP optimization (2022) | Keeps several plans per value range | Automatic | SQL Server 2022, compat level 160 |
| Better index | Makes one plan good for all values | Extra index | Almost always worth checking first |

### OPTION (RECOMPILE)

```sql
SELECT Id, OrderDate, Status, Total
FROM Orders
WHERE CustomerId = @CustomerId
OPTION (RECOMPILE);
```

Every call gets a plan built for its own value: a seek for customer 4242, a scan for customer 1. Simple and very effective — but compiling costs CPU. For a query called 2,000 times per second, it's too expensive. For a report run 50 times a day, it's perfect.

### OPTIMIZE FOR / OPTIMIZE FOR UNKNOWN

```sql
-- Build the plan as if the value was always 4242 (a "normal" customer)
OPTION (OPTIMIZE FOR (@CustomerId = 4242));

-- Ignore the value, use the average number of rows per customer
OPTION (OPTIMIZE FOR (@CustomerId UNKNOWN));
```

`UNKNOWN` gives the same plan to everybody, based on statistics: "on average, a customer has N orders". You lose the best plan for extreme values, but you never get the worst one by bad luck.

### Query Store: force a good plan

Query Store (ON by default since SQL Server 2022) keeps the history of plans for each query. In SSMS: **Database → Query Store → Queries With High Variation**. Find the good plan and force it:

```sql
EXEC sp_query_store_force_plan @query_id = 42, @plan_id = 7;
```

This is the fastest fix in production: no deployment. But it's a bandage — fix the root cause later and unforce the plan.

### SQL Server 2022 PSP optimization

With **Parameter Sensitive Plan optimization** (compatibility level 160), SQL Server detects skewed parameters and keeps **up to three plans** for the same query, one per range of row counts:

```sql
ALTER DATABASE CURRENT SET COMPATIBILITY_LEVEL = 160;
```

```sql
@CustomerId = 4242 → "small" variant → Seek + Lookup
@CustomerId = 1    → "large" variant → Scan
```

It doesn't fix every case, but on SQL Server 2022 it solves a lot of them for free.

### Better index: remove the choice

Remember the [covering index](/blog/2025/03/12/sqlserver-indexes-from-the-inside):

```sql
CREATE NONCLUSTERED INDEX IX_Orders_CustomerId
ON Orders (CustomerId)
INCLUDE (OrderDate, Status, Total)
WITH (DROP_EXISTING = ON);
```

Now there are no key lookups, so a seek is the best plan for **both** customers. When the same plan is good for every value, sniffing doesn't matter anymore.

---

## Dapper side: parameter types & lengths

Dapper sends your query with `sp_executesql`, so it's a parameterized query — sniffing applies exactly like with a stored procedure.

```csharp
public async Task<IEnumerable<OrderSummary>> GetCustomerOrdersAsync(int customerId)
{
    using var connection = new SqlConnection(_connectionString);

    return await connection.QueryAsync<OrderSummary>(
        "dbo.GetCustomerOrders",
        new { CustomerId = customerId },
        commandType: CommandType.StoredProcedure);
}
```

Two things to keep in mind on the .NET side:

**1. Same query text = same plan.** SQL Server caches plans per **query text + parameter types**. If you build SQL with string concatenation, every value creates a new plan — no sniffing, but the plan cache fills with thousands of single-use plans:

```csharp
// ❌ A new plan for every customer, and SQL injection risk
var sql = $"SELECT ... FROM Orders WHERE CustomerId = {customerId}";

// ✅ One plan, reused
var sql = "SELECT ... FROM Orders WHERE CustomerId = @CustomerId";
```

**2. Keep string types and lengths stable.** Dapper sends strings as `nvarchar(4000)` by default, so the plan doesn't change with the length of the value. If the column is `VARCHAR`, use `DbString` to avoid an implicit conversion:

```csharp
new { Status = new DbString { Value = status, IsAnsi = true, Length = 20 } }
```

### Adding RECOMPILE from Dapper

For an ad-hoc query that needs it, just add the hint to the SQL:

```csharp
const string sql = @"
    SELECT Id, OrderDate, Status, Total
    FROM Orders
    WHERE CustomerId = @CustomerId
    OPTION (RECOMPILE);";
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| "Fast in SSMS, slow in the app" → suspect sniffing first | Different `SET` options = different cached plan |
| Compare **compiled value** vs **runtime value** in the plan | It's the proof the plan was built for another value |
| Try a better (covering) index before any hint | One plan good for every value = no problem |
| `OPTION (RECOMPILE)` for rare or heavily skewed queries | Best plan every time, at CPU cost |
| `OPTIMIZE FOR UNKNOWN` for stable, average plans | No more "lucky first call" |
| Use Query Store to force a plan in an emergency | No deployment, but fix the root cause later |
| On SQL Server 2022, use compat level 160 | PSP optimization handles many cases automatically |
| Always parameterize, keep parameter types stable | Plan reuse without plan cache pollution |

>
> ## That's it & see you soon!.
>
