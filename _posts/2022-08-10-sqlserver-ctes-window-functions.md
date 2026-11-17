---
layout: post
title: "Sql server CTEs and window functions - ROW_NUMBER, RANK, LAG and running totals"
date: 2022-08-10
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL', 'SQLSERVER']
categories: ['SQLSERVER']
description: 'Sql server CTEs and window functions - ROW_NUMBER, RANK, LAG and running totals'
image: /images/covers/sqlserver-ctes-window-functions.png
---

A few years ago I wrote a short post on [removing duplicated rows with ROW_NUMBER()](/blog/2019/06/11/Sql-Server-Remove-duplicated-rows). That `OVER (PARTITION BY ...)` was the tip of a much bigger feature. "The latest order of each customer", "sales compared with last month", "a running total", "the top 3 products per category" — questions that usually end up as cursors, temp tables or C# loops can be answered in **one query** with **CTEs** and **window functions**. Let's go from the basics to real reporting queries, and see how to keep them fast.

We'll use one table throughout:

```sql
CREATE TABLE Orders
(
    Id          INT IDENTITY PRIMARY KEY,
    CustomerId  INT           NOT NULL,
    OrderDate   DATE          NOT NULL,
    Category    VARCHAR(50)   NOT NULL,
    Total       DECIMAL(18,2) NOT NULL
);
```

---

## CTEs: queries in readable steps

A **CTE** (Common Table Expression) names a subquery so you can use it like a table in the next query:

```sql
WITH MonthlySales AS
(
    SELECT YEAR(OrderDate)  AS [Year],
           MONTH(OrderDate) AS [Month],
           SUM(Total)       AS Revenue
    FROM Orders
    GROUP BY YEAR(OrderDate), MONTH(OrderDate)
)
SELECT *
FROM MonthlySales
WHERE Revenue > 10000
ORDER BY [Year], [Month];
```

Several CTEs can follow each other, each one using the previous ones:

```sql
WITH Step1 AS (...),
     Step2 AS (SELECT ... FROM Step1 ...),
     Step3 AS (SELECT ... FROM Step2 ...)
SELECT * FROM Step3;
```

A CTE is **not** a temp table: it's not stored, it's expanded into the final query (like a view that exists for one statement). Its value is **readability** — a complex query becomes a list of named steps.

### Recursive CTEs: trees

A CTE can reference **itself** — perfect for hierarchies like categories with sub-categories:

```sql
-- Categories(Id, ParentId, Name): ParentId NULL = top level
WITH CategoryTree AS
(
    SELECT Id, ParentId, Name, 0 AS Level, CAST(Name AS NVARCHAR(500)) AS Path
    FROM Categories
    WHERE ParentId IS NULL                                  -- anchor: the roots

    UNION ALL

    SELECT c.Id, c.ParentId, c.Name, t.Level + 1, CAST(t.Path + ' > ' + c.Name AS NVARCHAR(500))
    FROM Categories c
    JOIN CategoryTree t ON c.ParentId = t.Id                -- recursion: children of the previous level
)
SELECT * FROM CategoryTree ORDER BY Path;
```

```sql
Id | Level | Path
1  | 0     | Computers
4  | 1     | Computers > Laptops
9  | 2     | Computers > Laptops > Gaming
2  | 0     | Office
```

SQL Server stops after 100 levels by default (`OPTION (MAXRECURSION n)` to change it) — a safety net against cycles in your data.

---

## The core idea of window functions

`GROUP BY` **collapses** rows: one row per group. A window function computes over a group of rows **but keeps every row**:

```sql
-- GROUP BY: one row per customer
SELECT CustomerId, SUM(Total) AS CustomerTotal
FROM Orders
GROUP BY CustomerId;

-- Window function: every order, WITH its customer's total next to it
SELECT Id, CustomerId, Total,
       SUM(Total) OVER (PARTITION BY CustomerId) AS CustomerTotal,
       Total * 100.0 / SUM(Total) OVER (PARTITION BY CustomerId) AS PercentOfCustomer
FROM Orders;
```

```sql
Id | CustomerId | Total | CustomerTotal | PercentOfCustomer
1  | 7          | 100   | 400           | 25.0
2  | 7          | 300   | 400           | 75.0
3  | 9          | 50    | 50            | 100.0
```

> **OVER (...) defines the "window": which rows the function looks at for the current row. The row itself stays in the result.**

The window has up to three parts:

```sql
FUNCTION() OVER (
    PARTITION BY CustomerId            -- 1. which rows belong together (like GROUP BY, without collapsing)
    ORDER BY OrderDate                 -- 2. in which order (needed for ranking, LAG, running totals)
    ROWS BETWEEN ... AND ...           -- 3. which rows around the current one (the frame)
)
```

---

## ROW_NUMBER, RANK, DENSE_RANK

All three number rows in a partition. They differ only on **ties**:

```sql
SELECT CustomerId, Total,
       ROW_NUMBER() OVER (ORDER BY Total DESC) AS RowNum,
       RANK()       OVER (ORDER BY Total DESC) AS Rnk,
       DENSE_RANK() OVER (ORDER BY Total DESC) AS DenseRnk
FROM Orders;
```

| Total | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|
| 500 | 1 | 1 | 1 |
| 300 | 2 | 2 | 2 |
| 300 | 3 | 2 | 2 |
| 200 | 4 | **4** | **3** |

- `ROW_NUMBER`: always unique (ties get an arbitrary order — add a tie-breaker column to make it stable).
- `RANK`: ties share a rank, then it **skips** (1, 2, 2, 4) — like a sports ranking.
- `DENSE_RANK`: ties share a rank, **no gaps** (1, 2, 2, 3).

### Top N per group: the latest order of each customer

One of the most useful patterns in SQL:

```sql
WITH Ranked AS
(
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY OrderDate DESC, Id DESC) AS rn
    FROM Orders
)
SELECT Id, CustomerId, OrderDate, Total
FROM Ranked
WHERE rn = 1;            -- rn <= 3 for the last 3 orders of each customer
```

Window functions can't be used directly in `WHERE` (they're computed after it) — that's why the CTE is there.

"Top 3 products per category" is the same query with `PARTITION BY Category ORDER BY Revenue DESC` and `rn <= 3`. And the **deduplication** from the 2019 post is the same idea: number the duplicates, delete those with `rn > 1`:

```sql
WITH Duplicates AS
(
    SELECT *, ROW_NUMBER() OVER (PARTITION BY CustomerId, OrderDate, Total ORDER BY Id) AS rn
    FROM Orders
)
DELETE FROM Duplicates WHERE rn > 1;
```

---

## LAG and LEAD: compare with the previous row

`LAG` reads a value from a **previous** row of the window, `LEAD` from a **next** row. Month-over-month revenue:

```sql
WITH Monthly AS
(
    SELECT DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1) AS [Month],
           SUM(Total) AS Revenue
    FROM Orders
    GROUP BY DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1)
)
SELECT [Month],
       Revenue,
       LAG(Revenue) OVER (ORDER BY [Month])                        AS PreviousMonth,
       Revenue - LAG(Revenue) OVER (ORDER BY [Month])              AS Difference,
       CAST(100.0 * (Revenue - LAG(Revenue) OVER (ORDER BY [Month]))
            / NULLIF(LAG(Revenue) OVER (ORDER BY [Month]), 0) AS DECIMAL(6,1)) AS GrowthPercent
FROM Monthly
ORDER BY [Month];
```

```sql
Month      | Revenue | PreviousMonth | Difference | GrowthPercent
2022-05-01 | 18 200  | NULL          | NULL       | NULL
2022-06-01 | 21 400  | 18 200        | 3 200      | 17.6
2022-07-01 | 19 900  | 21 400        | -1 500     | -7.0
```

Other uses: time between two orders of the same customer (`DATEDIFF(DAY, LAG(OrderDate) OVER (PARTITION BY CustomerId ORDER BY OrderDate), OrderDate)`), detecting status changes in a history table, gaps in sequences. `LAG(col, 12)` looks 12 rows back — same month last year.

---

## Running totals and moving averages

With `ORDER BY` inside `OVER`, `SUM` becomes **cumulative**. The frame clause says exactly which rows to include:

```sql
SELECT [Month], Revenue,
       SUM(Revenue) OVER (ORDER BY [Month]
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RunningTotal,
       AVG(Revenue) OVER (ORDER BY [Month]
                          ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)         AS MovingAvg3Months
FROM Monthly;
```

| Frame | Rows used |
|---|---|
| `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` | From the first row up to this one (running total) |
| `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` | This row and the 2 before (3-month moving average) |
| `ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING` | From this row to the end (remaining total) |

Always write the frame explicitly with `ROWS`. Without it, an `ORDER BY` in `OVER` uses `RANGE UNBOUNDED PRECEDING` by default, which treats rows with the **same** `ORDER BY` value as one block (surprising results on ties) and is **slower** (it spools to tempdb instead of working in memory).

Running totals per customer? Add `PARTITION BY CustomerId`: the total restarts for each customer.

---

## NTILE and percent of total

```sql
SELECT CustomerId, CustomerTotal,
       NTILE(4) OVER (ORDER BY CustomerTotal DESC)               AS Quartile,       -- 1 = best 25%
       CustomerTotal * 100.0 / SUM(CustomerTotal) OVER ()       AS PercentOfAll    -- OVER () = all rows
FROM (SELECT CustomerId, SUM(Total) AS CustomerTotal FROM Orders GROUP BY CustomerId) AS c;
```

`OVER ()` with nothing inside = the window is the whole result: perfect for "percent of the grand total" without a second query.

---

## Performance

Window functions sort rows by `PARTITION BY` + `ORDER BY`. On a big table, that sort is the cost — unless an index already has the rows in that order:

```sql
-- For: ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY OrderDate DESC)
CREATE INDEX IX_Orders_Customer_Date
ON Orders (CustomerId, OrderDate DESC)
INCLUDE (Total);
```

With it, the execution plan reads the index in order and the **Sort** operator disappears. Tips:

- Index = `PARTITION BY` columns, then `ORDER BY` columns, then `INCLUDE` the selected columns.
- Filter early (in the CTE) to window over fewer rows.
- Reuse the same `OVER (...)` definition when possible: SQL Server can compute several functions with one sort.
- Prefer `ROWS` to the default `RANGE` frame.

---

## Using them from Dapper

Nothing special — it's just SQL:

```csharp
public async Task<IEnumerable<LatestOrder>> GetLatestOrderPerCustomerAsync()
{
    const string sql = @"
        WITH Ranked AS
        (
            SELECT Id, CustomerId, OrderDate, Total,
                   ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY OrderDate DESC, Id DESC) AS rn
            FROM Orders
        )
        SELECT Id, CustomerId, OrderDate, Total FROM Ranked WHERE rn = 1;";

    using var connection = new SqlConnection(_connectionString);
    return await connection.QueryAsync<LatestOrder>(sql);
}
```

One query instead of loading every order into memory and grouping in C# — the database does what it's best at.

---

## Key rules to remember

| Rule | Why |
|---|---|
| CTEs make complex queries a list of named steps | Readability, not storage |
| Recursive CTEs for trees (anchor + `UNION ALL` + recursion) | Hierarchies in one query |
| Window functions compute over rows without collapsing them | Details and aggregates side by side |
| `PARTITION BY` = groups, `ORDER BY` = order, frame = which rows | The three parts of `OVER` |
| `ROW_NUMBER` unique, `RANK` skips after ties, `DENSE_RANK` doesn't | Choose by how ties should behave |
| Top N per group: `ROW_NUMBER` in a CTE, filter `rn <= N` | Window functions can't go in `WHERE` |
| `LAG` / `LEAD` to compare with previous / next rows | Month over month, time between events |
| Always write the frame with `ROWS BETWEEN ...` | Default `RANGE` is slower and surprising on ties |
| `OVER ()` for percent of the grand total | No second query |
| Index on partition + order columns | Removes the sort, the main cost |

>
> ## That's it & see you soon!.
>
