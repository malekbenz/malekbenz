---
layout: post
title: "Big tables in React with AG Grid - Server-side paging, sorting and filtering"
date: 2024-07-24
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Javascript', 'Asp.Net', 'Dapper']
categories: ['React', 'Javascript']
description: 'Big tables in React with AG Grid - Server-side paging, sorting and filtering'
image: /images/covers/react-ag-grid-server-side-data.png
---

The orders grid was perfect in the demo: 500 rows, instant sorting, filters on every column. One year later, the same page loads **120,000** rows — the API takes 9 seconds, the JSON is 40 MB, the browser tab uses 1.5 GB, and sorting freezes the page. AG Grid isn't the problem: it handles big data very well, **if** you let the server do the heavy work. Let's move paging, sorting and filtering to an ASP.NET Core + Dapper API, using AG Grid's free **Infinite Row Model** — and keep the SQL safe while doing it.

## The core idea: the browser shows a window, the server does the work

```sql
Client-side:   API sends 120,000 rows → the browser sorts, filters, pages them      (slow, heavy)
Server-side:   the grid asks "rows 0–100, sorted by date desc, status = Paid"
               → SQL Server returns 100 rows + the total count                     (fast, light)
               scroll down → "rows 100–200" → ...
```

The user sees the same grid, with the same sorting and filters. But the browser never holds more than a few hundred rows, and SQL Server — which has indexes — does the sorting and filtering.

> **Send the browser what the user can see, not everything the user could see.**

---

## Client-side row model: great, until when?

By default, AG Grid uses the **client-side row model**: you give it all the rows (`rowData`), and it does everything in the browser. That's the right choice for most grids:

| Rows | Client-side row model |
|---|---|
| Up to a few thousand | ✅ Perfect — instant sorting and filtering, simplest code |
| Tens of thousands | ⚠️ Works, but the initial load (API + JSON + memory) becomes the problem |
| 100,000+ and growing | ❌ Move the work to the server |

AG Grid has three row models:

| Row model | Data loaded | Edition |
|---|---|---|
| Client-side (default) | Everything, upfront | Community (free) |
| **Infinite** | Blocks of rows as you scroll, sorted/filtered by your server | **Community (free)** |
| Server-side | Blocks + server-side grouping, pivoting, tree data | Enterprise (paid license) |

If you don't need grouping or pivoting on the server, the **Infinite Row Model** gives you server-side paging, sorting and filtering for free.

---

## Column definitions, once

Before the data part, a tip for apps with many grids: define the common column behavior **once**.

```jsx
// grid/useGridDefaults.js
import { useMemo } from 'react';

export function useGridDefaults() {
  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
    floatingFilter: true,                                // the filter row under the headers
    filterParams: { debounceMs: 500, maxNumConditions: 1 },
  }), []);

  return { defaultColDef };
}
```

```jsx
const columnDefs = useMemo(() => [
  { field: 'id', headerName: '#', width: 90, filter: 'agNumberColumnFilter' },
  { field: 'customerName', headerName: 'Customer', filter: 'agTextColumnFilter', flex: 1 },
  { field: 'status', filter: 'agTextColumnFilter', width: 130 },
  { field: 'orderDate', headerName: 'Date', filter: 'agDateColumnFilter', width: 140,
    valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleDateString() : '') },
  { field: 'total', filter: 'agNumberColumnFilter', width: 120,
    valueFormatter: (p) => (p.value != null ? `${p.value.toFixed(2)} €` : '') },
], []);
```

`useMemo` matters here: a new `columnDefs` array on every render makes the grid re-apply the columns (the [reference vs value](/blog/2023/10/11/javascript-reference-vs-value) trap again).

---

## The Infinite Row Model

Instead of `rowData`, the grid gets a **datasource** with one method: `getRows`. The grid calls it whenever it needs a block of rows — on first display, on scroll, and every time the user sorts or filters.

```jsx
// orders/OrdersGrid.jsx
import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { useGridDefaults } from '../grid/useGridDefaults';

const gridStyle = { height: 600, width: '100%' };

export function OrdersGrid() {
  const { defaultColDef } = useGridDefaults();
  const columnDefs = useOrderColumns();            // the useMemo'd array from above

  const datasource = useMemo(() => ({
    getRows: async (params) => {
      try {
        const response = await fetch('/api/orders/grid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startRow: params.startRow,
            endRow: params.endRow,
            sortModel: params.sortModel,           // [{ colId: 'orderDate', sort: 'desc' }]
            filterModel: params.filterModel,       // { status: { filterType: 'text', type: 'equals', filter: 'Paid' } }
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const { rows, lastRow } = await response.json();
        params.successCallback(rows, lastRow);     // lastRow = total count → the scrollbar has the right size
      } catch {
        params.failCallback();
      }
    },
  }), []);

  return (
    <div className="ag-theme-quartz" style={gridStyle}>
      <AgGridReact
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={100}                       // rows per request
        maxBlocksInCache={10}                      // keep at most 1,000 rows in memory
        getRowId={(p) => String(p.data.id)}
      />
    </div>
  );
}
```

```sql
Open the page         → getRows(0, 100)
Scroll down           → getRows(100, 200), getRows(200, 300)...
Sort by Total         → cache cleared → getRows(0, 100, sortModel: total desc)
Type "dub" in Customer→ (after 500 ms debounce) → getRows(0, 100, filterModel: customerName contains "dub")
```

In the real app, use your RTK Query base query or a shared `fetch` wrapper (with the auth token) instead of a raw `fetch` — the datasource is just a function.

---

## The API: Dapper, OFFSET/FETCH, safe sorting and filtering

The request mirrors what the grid sends:

```csharp
public record GridRequest(int StartRow, int EndRow, List<SortItem>? SortModel, Dictionary<string, FilterItem>? FilterModel);
public record SortItem(string ColId, string Sort);
public record FilterItem(string FilterType, string Type, JsonElement? Filter, string? DateFrom, string? DateTo);
public record GridResponse<T>(IReadOnlyList<T> Rows, int LastRow);
```

The **most important** part: column names come from the browser. Never put them into SQL directly — map them through a **whitelist**:

```csharp
public sealed class OrdersGridQuery(IDbConnectionFactory db)
{
    // grid column id → SQL expression. Anything not in this list is ignored.
    private static readonly Dictionary<string, string> Columns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["id"] = "o.Id",
        ["customerName"] = "c.Name",
        ["status"] = "o.Status",
        ["orderDate"] = "o.OrderDate",
        ["total"] = "o.Total",
    };

    public async Task<GridResponse<OrderRow>> RunAsync(GridRequest request, CancellationToken ct)
    {
        var take = Math.Clamp(request.EndRow - request.StartRow, 1, 500);   // never trust the size either
        var parameters = new DynamicParameters(new { Offset = Math.Max(0, request.StartRow), Take = take });

        var where = BuildWhere(request.FilterModel, parameters);
        var orderBy = BuildOrderBy(request.SortModel);

        var sql = $@"
            SELECT o.Id, c.Name AS CustomerName, o.Status, o.OrderDate, o.Total,
                   COUNT(*) OVER () AS TotalCount
            FROM Orders o
            JOIN Customers c ON c.Id = o.CustomerId
            {where}
            ORDER BY {orderBy}
            OFFSET @Offset ROWS FETCH NEXT @Take ROWS ONLY;";

        using var connection = db.Create();
        var rows = (await connection.QueryAsync<OrderRow>(new CommandDefinition(sql, parameters, cancellationToken: ct))).ToList();

        var total = rows.FirstOrDefault()?.TotalCount ?? (request.StartRow == 0 ? 0 : request.StartRow);
        return new GridResponse<OrderRow>(rows, total);
    }

    private static string BuildOrderBy(List<SortItem>? sortModel)
    {
        var parts = (sortModel ?? new List<SortItem>())
            .Where(s => Columns.ContainsKey(s.ColId))
            .Select(s => $"{Columns[s.ColId]} {(s.Sort == "desc" ? "DESC" : "ASC")}")
            .ToList();

        parts.Add("o.Id DESC");        // a unique tie-breaker: stable paging
        return string.Join(", ", parts);
    }
}
```

The SQL text only ever contains strings **we** wrote (`o.OrderDate`, `DESC`); every value from the user is a **parameter**. Two other details:

- **`COUNT(*) OVER ()`** returns the total number of matching rows on every row — one query for data and count. (On very large tables, a separate `COUNT` query with the same `WHERE` can be faster; measure.)
- **A unique tie-breaker** in `ORDER BY`: without it, rows with the same date can appear on two pages or on none, because SQL Server doesn't guarantee an order for ties.

### Wiring filters to SQL safely

AG Grid's filter model is a small JSON per column. Translate only what you support:

```csharp
private static string BuildWhere(Dictionary<string, FilterItem>? filters, DynamicParameters p)
{
    var conditions = new List<string>();
    var i = 0;

    foreach (var (colId, f) in filters ?? new Dictionary<string, FilterItem>())
    {
        if (!Columns.TryGetValue(colId, out var column)) continue;
        var name = $"@f{i++}";

        switch (f.FilterType, f.Type)
        {
            case ("text", "contains"):
                conditions.Add($"{column} LIKE {name}");
                p.Add(name, $"%{EscapeLike(f.Filter?.GetString())}%");
                break;
            case ("text", "equals"):
                conditions.Add($"{column} = {name}");
                p.Add(name, f.Filter?.GetString());
                break;
            case ("number", "greaterThan"):
                conditions.Add($"{column} > {name}");
                p.Add(name, f.Filter?.GetDecimal());
                break;
            case ("number", "lessThan"):
                conditions.Add($"{column} < {name}");
                p.Add(name, f.Filter?.GetDecimal());
                break;
            case ("date", "inRange"):
                conditions.Add($"{column} >= {name}a AND {column} < {name}b");
                p.Add($"{name}a", DateTime.Parse(f.DateFrom!).Date);
                p.Add($"{name}b", DateTime.Parse(f.DateTo!).Date.AddDays(1));
                break;
        }
    }

    return conditions.Count > 0 ? "WHERE " + string.Join(" AND ", conditions) : "";
}

private static string EscapeLike(string? value) =>
    (value ?? "").Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]");
```

And limit the filter options in the grid to the ones the server supports, so users can't pick an option that does nothing:

```jsx
{ field: 'status', filter: 'agTextColumnFilter', filterParams: { filterOptions: ['equals', 'contains'] } },
{ field: 'total', filter: 'agNumberColumnFilter', filterParams: { filterOptions: ['greaterThan', 'lessThan'] } },
```

```csharp
app.MapPost("/api/orders/grid", (GridRequest request, OrdersGridQuery query, CancellationToken ct) =>
    query.RunAsync(request, ct))
   .RequireAuthorization();
```

---

## Refreshing, row ids and debounced filters

- **`getRowId`**: gives each row a stable identity (the order id). After a refresh, the grid updates rows in place instead of re-creating them, and keeps the selection.
- **After an edit or a delete**, ask the grid to reload its blocks:

```jsx
const gridRef = useRef(null);

async function cancelOrder(id) {
  await cancelOrderMutation(id).unwrap();
  gridRef.current.api.refreshInfiniteCache();     // re-fetch the visible blocks
}

<AgGridReact ref={gridRef} /* ... */ />
```

- **`debounceMs`** on text filters (set in `defaultColDef` above): without it, typing "dubois" sends six requests.

---

## Performance tips

| Tip | Why |
|---|---|
| Index the columns users sort and filter on most (date, status, customer) | `ORDER BY ... OFFSET` on an unindexed column scans and sorts the whole table |
| Select only the grid's columns, never `SELECT *` | Smaller rows, covering indexes possible |
| `cacheBlockSize` 50–200 | Fewer requests vs smaller responses |
| `maxBlocksInCache` | Caps browser memory on very long scrolls |
| Clamp the page size on the server | A crafted request can't ask for 1,000,000 rows |
| `LIKE '%text%'` can't use an index | For heavy text search on big tables, consider full-text search |

---

## Key rules to remember

| Rule | Why |
|---|---|
| Client-side row model up to a few thousand rows | Simplest and fastest at that size |
| Big or growing data → Infinite Row Model (free) | Server-side paging, sorting, filtering without Enterprise |
| `columnDefs` and `defaultColDef` with `useMemo`, shared defaults | No re-applied columns, consistent grids |
| `getRows` sends start/end, sort and filter models; reply with `lastRow` | The scrollbar and paging stay correct |
| Whitelist column names, parameterize every value | No SQL injection through sort or filter fields |
| `OFFSET/FETCH` with a unique tie-breaker | Stable pages |
| `COUNT(*) OVER ()` or a separate count | Total rows for the scrollbar |
| Restrict filter options to what the server supports | No silently ignored filters |
| `getRowId`, `refreshInfiniteCache`, `debounceMs` | Correct refreshes, fewer requests |
| Index sorted and filtered columns | The server must be fast for the grid to feel fast |

>
> ## That's it & see you soon!.
>
