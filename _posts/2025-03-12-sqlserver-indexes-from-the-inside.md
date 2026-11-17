---
layout: post
title: "Sql server Indexes from the inside - Clustered, Non-clustered and Covering"
date: 2025-03-12
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL', 'SQLSERVER']
categories: ['SQLSERVER']
description: 'Sql server Indexes from the inside - Clustered, Non-clustered and Covering'
image: /images/covers/sqlserver-indexes-from-the-inside.png
---

If your query was fast with 1,000 rows and now takes 8 seconds with 2 million, the problem is almost never the server — it's how SQL Server has to walk through your data to find the rows. Let's open the box and see how indexes are really stored, so you know exactly which index to create and why.

## The core idea: pages and B-trees

SQL Server never reads a single row. It reads **pages**.

```sql
1 page   = 8 KB  (about 8,060 bytes for row data)
1 extent = 8 pages = 64 KB
```

Every table and every index is a set of pages. An index organizes those pages as a **B-tree** (balanced tree):

```sql
                 [ Root page ]
                /      |      \
     [ Intermediate ] [ ... ] [ Intermediate ]
       /     |    \
  [Leaf] [Leaf] [Leaf] [Leaf] ...   ← linked together left ↔ right
```

- The **root** and **intermediate** pages only hold keys and pointers to the next level.
- The **leaf** pages hold the actual data (or a pointer to it).
- Finding one row in a table with millions of rows usually costs only **3 or 4 page reads** — one per level.

> **An index is not magic. It's just a sorted copy of some columns, organized so SQL Server can jump to the right page instead of reading all of them.**

---

## Setup — the table we'll use throughout

```sql
CREATE TABLE Orders
(
    Id          INT IDENTITY(1,1) NOT NULL,
    CustomerId  INT           NOT NULL,
    OrderDate   DATETIME2     NOT NULL,
    Status      VARCHAR(20)   NOT NULL,
    Total       DECIMAL(18,2) NOT NULL,
    Notes       NVARCHAR(500) NULL
);

-- Fill it with 2 million rows
INSERT INTO Orders (CustomerId, OrderDate, Status, Total)
SELECT TOP (2000000)
       ABS(CHECKSUM(NEWID())) % 50000,
       DATEADD(DAY, -ABS(CHECKSUM(NEWID())) % 1500, SYSDATETIME()),
       CASE ABS(CHECKSUM(NEWID())) % 3 WHEN 0 THEN 'New' WHEN 1 THEN 'Paid' ELSE 'Shipped' END,
       ABS(CHECKSUM(NEWID())) % 100000 / 100.0
FROM sys.all_objects a CROSS JOIN sys.all_objects b;
```

To see how much work each query does, turn this on in SSMS:

```sql
SET STATISTICS IO ON;
```

The number to watch is **logical reads** — how many pages SQL Server had to touch.

---

## Heap vs clustered index

### Heap — a table with no clustered index

Right now `Orders` is a **heap**: rows are stored in no particular order, wherever there is free space.

```sql
SELECT * FROM Orders WHERE Id = 123456;
-- Table Scan
-- logical reads: ~14,000
```

SQL Server has no idea where `Id = 123456` is, so it reads **every page**.

### Clustered index — the table *is* the index

```sql
ALTER TABLE Orders ADD CONSTRAINT PK_Orders PRIMARY KEY CLUSTERED (Id);

SELECT * FROM Orders WHERE Id = 123456;
-- Clustered Index Seek
-- logical reads: 3
```

From 14,000 page reads to 3. With a clustered index, the **leaf level contains the full rows**, sorted by the key. That's why:

- A table can have **only one** clustered index (rows can only be physically sorted one way).
- A good clustered key is **narrow, unique, static and ever-increasing** — `INT IDENTITY` is the classic choice.

| | Heap | Clustered index |
|---|---|---|
| Row order | None | Sorted by key |
| Find by key | ❌ Full scan | ✅ Seek (3–4 reads) |
| Row locator used by other indexes | RID (file:page:slot) | The clustered key |
| Good for | Staging / bulk-load tables | Almost every other table |

---

## Non-clustered index & the key lookup

### Scenario — orders search by customer

The most common query in our app:

```sql
SELECT Id, OrderDate, Status, Total
FROM Orders
WHERE CustomerId = 4242;
-- Clustered Index Scan
-- logical reads: ~14,000
```

The table is sorted by `Id`, not by `CustomerId`, so it's a full scan again. Let's add a non-clustered index:

```sql
CREATE NONCLUSTERED INDEX IX_Orders_CustomerId ON Orders (CustomerId);
```

A non-clustered index is a **separate B-tree**. Its leaf level holds only:

```sql
[ CustomerId | Id ]   ← the index key + the clustered key (row locator)
```

Run the query again:

```sql
-- Index Seek (IX_Orders_CustomerId)  → finds the ~40 matching Ids
-- Key Lookup (PK_Orders)              → one lookup PER ROW to get OrderDate, Status, Total
-- logical reads: ~125
```

Much better, but look at the **Key Lookup**. For each of the 40 rows, SQL Server goes back to the clustered index to fetch the missing columns. That's 40 extra trips of 3 reads each.

With 40 rows it's fine. With 40,000 rows, SQL Server decides that the lookups cost more than a full scan, **ignores your index**, and scans the table again. This is the famous *tipping point*.

---

## Covering indexes with INCLUDE

The fix: put the columns the query needs **inside the index**, so it never has to go back to the table.

```sql
CREATE NONCLUSTERED INDEX IX_Orders_CustomerId
ON Orders (CustomerId)
INCLUDE (OrderDate, Status, Total)
WITH (DROP_EXISTING = ON);
```

```sql
SELECT Id, OrderDate, Status, Total
FROM Orders
WHERE CustomerId = 4242;
-- Index Seek (IX_Orders_CustomerId) — no Key Lookup
-- logical reads: 3
```

The index now **covers** the query.

- **Key columns** (`ON (...)`) are sorted and can be used for seeks, ranges and `ORDER BY`.
- **Included columns** (`INCLUDE (...)`) only live at the leaf level. They can't be searched, but they're there to be returned.

> **This is why `SELECT *` hurts: it makes it almost impossible to cover a query.** Select only the columns you need.

---

## Reading the execution plan (Seek vs Scan)

Press **Ctrl+M** in SSMS (Include Actual Execution Plan) and run the query. These are the operators you'll meet most:

| Operator | What it means | Good or bad? |
|---|---|---|
| Index Seek | Jumps straight to the matching rows | ✅ Usually what you want |
| Index Scan / Clustered Index Scan | Reads the whole index | ⚠️ Fine for small tables or when you need most rows |
| Table Scan | Reads the whole heap | ❌ On a big table, add an index |
| Key Lookup / RID Lookup | Goes back to the table for missing columns | ⚠️ OK for few rows, add INCLUDE columns otherwise |
| Sort | Sorts rows in memory (or tempdb) | ⚠️ An index on the ORDER BY columns can remove it |

### The SARGable trap

An index can only be used for a seek if the column is **left alone** in the `WHERE` clause:

```sql
-- ❌ Scan: the function hides the column from the index
WHERE YEAR(OrderDate) = 2024

-- ✅ Seek: same result, the column is untouched
WHERE OrderDate >= '2024-01-01' AND OrderDate < '2025-01-01'
```

Same thing for `ISNULL(Status, '') = 'Paid'`, `CustomerId + 1 = 10`, or `Notes LIKE '%refund%'` (a leading wildcard can't seek).

---

## Composite indexes: column order matters

### Scenario — paid orders of a customer, newest first

```sql
SELECT Id, OrderDate, Total
FROM Orders
WHERE CustomerId = 4242 AND Status = 'Paid'
ORDER BY OrderDate DESC;
```

An index on several columns is sorted by the **first** column, then the **second** inside it, and so on — like a phone book sorted by last name, then first name.

```sql
CREATE NONCLUSTERED INDEX IX_Orders_Customer_Status_Date
ON Orders (CustomerId, Status, OrderDate DESC)
INCLUDE (Total);
```

- `CustomerId = 4242` → seek to that customer.
- `Status = 'Paid'` → seek inside that customer.
- `OrderDate DESC` → rows are **already in order**, no Sort operator.

The rule of thumb:

```sql
1. Equality columns first   (=)
2. Then range / sort columns (>, <, BETWEEN, ORDER BY)
3. Everything else the query returns → INCLUDE
```

If you put `OrderDate` first, the index is useless for `WHERE CustomerId = 4242` — just like a phone book sorted by first name is useless when you only know the last name.

---

## The cost: every index slows writes

Indexes are not free. Every `INSERT`, `UPDATE` and `DELETE` must update **every** index that contains the changed columns.

```sql
INSERT INTO Orders ...   → writes to PK_Orders
                          + IX_Orders_CustomerId
                          + IX_Orders_Customer_Status_Date
                          + ...every other index
```

So:

- Don't create one index per query. Try to make **one index serve several queries**.
- Remove indexes nobody uses. This query shows indexes with many writes and no reads:

```sql
SELECT  OBJECT_NAME(s.object_id) AS TableName,
        i.name                   AS IndexName,
        s.user_seeks, s.user_scans, s.user_lookups,
        s.user_updates
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE s.database_id = DB_ID()
  AND i.type_desc = 'NONCLUSTERED'
ORDER BY s.user_updates DESC;
```

> These stats reset when SQL Server restarts — check them after the server has been running for a while.

---

## Querying with Dapper in .NET

Let's call our covered query from a .NET app with Dapper:

```csharp
public record OrderSummary(int Id, DateTime OrderDate, string Status, decimal Total);

public class OrderRepository
{
    private readonly string _connectionString;

    public OrderRepository(string connectionString) => _connectionString = connectionString;

    public async Task<IEnumerable<OrderSummary>> GetPaidOrdersAsync(int customerId)
    {
        const string sql = @"
            SELECT Id, OrderDate, Status, Total
            FROM Orders
            WHERE CustomerId = @CustomerId AND Status = @Status
            ORDER BY OrderDate DESC;";

        using var connection = new SqlConnection(_connectionString);

        return await connection.QueryAsync<OrderSummary>(sql, new
        {
            CustomerId = customerId,
            Status = new DbString { Value = "Paid", IsAnsi = true, Length = 20 }
        });
    }
}
```

### Why `DbString` with `IsAnsi = true`?

A .NET `string` is sent as **`NVARCHAR`** by default. Our `Status` column is **`VARCHAR`**. SQL Server then has to convert the column to compare it, and the plan shows:

```sql
CONVERT_IMPLICIT(nvarchar(20), [Status], 0) = @Status
```

Depending on the collation, this can turn your nice **seek** into a **scan** — the index is there, but the query can't use it properly. Telling Dapper the real type (`IsAnsi = true`, `Length = 20`) keeps the plan clean.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Every table gets a clustered index (narrow, unique, increasing key) | Seeks instead of heap scans, compact non-clustered indexes |
| Watch **logical reads**, not just duration | Pages read is the real cost |
| Equality columns first, range/sort columns next | Matches how the B-tree is sorted |
| Use `INCLUDE` to remove Key Lookups | One seek, no trips back to the table |
| Avoid `SELECT *` | You can't cover a query that needs every column |
| Keep the column clean in `WHERE` (no functions) | Otherwise the index can't seek |
| Match parameter types to column types (`DbString`) | Avoids `CONVERT_IMPLICIT` scans |
| Drop indexes with many updates and no reads | Every index slows every write |

>
> ## That's it & see you soon!.
>
