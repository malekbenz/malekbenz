---
layout: post
title: "Elasticsearch for .NET developers - Mappings, search and the .NET client"
date: 2025-11-12
author: Malekbenz
comments: true
category: elasticsearch
tags : [ 'elasticsearch', '.Net', 'C#']
categories: ['elasticsearch', '.Net']
description: 'Elasticsearch for .NET developers - Mappings, search and the .NET client'
image: /images/covers/elasticsearch-for-dotnet-developers.png
---

The search page uses `WHERE Name LIKE '%' + @text + '%'`. With 10,000 rows it was fine. With 20 million rows it scans the whole table, it doesn't find "Dubois" when the user types "dubios", and the "results per city" counters on the side take 6 seconds. I've used Elasticsearch on big projects exactly for this. Let's see how it really works — mappings, analyzers, queries, aggregations — and how to use it from .NET with the official client.

Back in 2018 I wrote a short post about [reindexing in Elasticsearch](/blog/2018/01/24/Reindexing-in-Elasticsearch). A lot changed since then (mapping types are gone, the .NET client was rewritten), so this post is also a refresh.

## The core idea: the inverted index

A SQL index is sorted by **value**. Elasticsearch builds an **inverted index**: for every **word**, the list of documents that contain it.

```sql
Doc 1: "Fast delivery to Lyon"
Doc 2: "Delivery delayed in Paris"
Doc 3: "Fast payment"

Inverted index (after analysis):
  "fast"      → [1, 3]
  "delivery"  → [1, 2]
  "lyon"      → [1]
  "delayed"   → [2]
  "paris"     → [2]
  "payment"   → [3]
```

Searching "fast delivery" = read two small lists and combine them. No scan, whatever the number of documents. And every match gets a **relevance score** (BM25): documents with more matching words, and rarer words, come first.

> **SQL Server is your source of truth. Elasticsearch is a search engine built from it — a read model you can always rebuild.**

---

## The vocabulary

| Elasticsearch | Closest SQL idea | Note |
|---|---|---|
| Index | Table | `orders` |
| Document | Row | JSON, with an `_id` |
| Mapping | Schema | Field types and how text is analyzed |
| Shard | Partition | An index is split into shards, spread over nodes |
| Replica | Copy of a shard | High availability + more read capacity |
| Refresh | — | New documents are searchable after ~1 second (near real-time) |

Note that the old "type" (`/myindex/developer` in my 2018 post) doesn't exist anymore — one index holds one kind of document.

### Run it locally

```sql
docker run -d --name es -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms1g -Xmx1g" \
  docker.elastic.co/elasticsearch/elasticsearch:<version>
```

Use the same **major version** as your .NET client (8.x or 9.x). `xpack.security.enabled=false` is for your dev machine only — in production, security (TLS + users / API keys) stays ON. Add Kibana and use **Dev Tools** to run the requests below.

---

## Mappings: text vs keyword

If you just send JSON, Elasticsearch guesses the types (**dynamic mapping**). It's handy for a test, dangerous in production: a field that receives `"42"` once becomes text forever, and a typo in a field name creates a new field.

Define the mapping yourself:

```json
PUT orders_v1
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "folding": {
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "orderId":      { "type": "integer" },
      "customerName": {
        "type": "text",
        "analyzer": "folding",
        "fields": { "raw": { "type": "keyword" } }
      },
      "city":         { "type": "keyword" },
      "status":       { "type": "keyword" },
      "notes":        { "type": "text", "analyzer": "folding" },
      "total":        { "type": "scaled_float", "scaling_factor": 100 },
      "orderDate":    { "type": "date" }
    }
  }
}
```

The important choices:

| Type | Stored as | Use for | Query with |
|---|---|---|---|
| `text` | Analyzed words | Full-text search (names, notes, descriptions) | `match` |
| `keyword` | The exact value | Filters, sorting, aggregations (status, city, codes) | `term` |
| `text` + `fields.raw` (keyword) | Both | Search **and** sort/aggregate on the same field | `match` on `customerName`, sort on `customerName.raw` |

`"dynamic": "strict"` makes Elasticsearch **reject** documents with unknown fields — the same "fail fast" idea as `ValidateOnStart()` in the [configuration post](/blog/2025/07/09/aspnet-core-configuration-done-right).

### Analyzers: why "Hélène" finds "helene"

An analyzer turns text into the words stored in the inverted index. Test it with `_analyze`:

```json
POST orders_v1/_analyze
{
  "analyzer": "folding",
  "text": "Livraison à Besançon — Hélène"
}
```

```json
["livraison", "a", "besancon", "helene"]
```

`lowercase` + `asciifolding` remove case and accents — essential for French and for names typed by users. The same analyzer runs on the **query**, so "BESANCON", "Besançon" and "besancon" all match.

---

## Indexing documents

```json
PUT orders_v1/_doc/42
{
  "orderId": 42,
  "customerName": "Hélène Dubois",
  "city": "Paris",
  "status": "Paid",
  "notes": "Fast delivery requested",
  "total": 1250.50,
  "orderDate": "2025-10-30T14:20:00Z"
}
```

Use your SQL primary key as the `_id`. Indexing the same id again **replaces** the document — so re-syncing is safe (idempotent).

For many documents, never send them one by one — use `_bulk` (we'll do it from .NET below).

---

## Searching: the bool query

Almost every real search is a `bool` query with four parts:

| Clause | Must match? | Affects the score? | Use for |
|---|---|---|---|
| `must` | ✅ | ✅ | What the user typed |
| `should` | Optional (boosts) | ✅ | "Nice to have" — rank some results higher |
| `filter` | ✅ | ❌ (and cached) | Status, dates, city — yes/no conditions |
| `must_not` | ❌ must not | ❌ | Exclusions |

### Scenario — the order search page

"Paid orders of the last 90 days, matching what the user typed, with typos allowed":

```json
GET orders/_search
{
  "from": 0,
  "size": 20,
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "dubios fast",
            "fields": ["customerName^3", "notes"],
            "fuzziness": "AUTO"
          }
        }
      ],
      "filter": [
        { "term":  { "status": "Paid" } },
        { "range": { "orderDate": { "gte": "now-90d/d" } } }
      ]
    }
  },
  "sort": [ "_score", { "orderDate": "desc" } ]
}
```

- `customerName^3`: a match in the name counts **3 times** more than in the notes.
- `fuzziness: AUTO`: "dubios" still finds "dubois" (1–2 letter differences, depending on the word length).
- Status and date are in `filter`: no scoring, and Elasticsearch caches them — faster.

The classic mistake: `term` on a `text` field.

```json
{ "term": { "customerName": "Hélène Dubois" } }     ❌ no result: the index contains "helene", "dubois"
{ "match": { "customerName": "Hélène Dubois" } }    ✅ analyzed like the field
{ "term": { "customerName.raw": "Hélène Dubois" } } ✅ exact value on the keyword sub-field
```

### Paging: from/size has a limit

`from + size` is limited to **10,000** results by default, and deep pages are expensive. For "infinite scroll" or exports, use `search_after` with a **point in time** (PIT): you pass the sort values of the last hit to get the next page.

---

## Aggregations: the side counters

The "results per city" and "sales per month" next to the search results come from **aggregations**, computed on the same query in one request:

```json
GET orders/_search
{
  "size": 0,
  "query": { "range": { "orderDate": { "gte": "now-1y/d" } } },
  "aggs": {
    "by_city": {
      "terms": { "field": "city", "size": 10 }
    },
    "by_month": {
      "date_histogram": { "field": "orderDate", "calendar_interval": "month" },
      "aggs": {
        "revenue": { "sum": { "field": "total" } }
      }
    }
  }
}
```

```json
"by_city":  { "buckets": [ { "key": "Paris", "doc_count": 812345 }, { "key": "Lyon", "doc_count": 402118 }, ... ] }
"by_month": { "buckets": [ { "key_as_string": "2025-10-01", "doc_count": 98211, "revenue": { "value": 12873455.5 } }, ... ] }
```

`size: 0` = "I only want the aggregations, not the documents". Aggregations work on `keyword`, numbers and dates — not on `text` (that's why `city` is a keyword).

---

## The .NET client

The official client is **`Elastic.Clients.Elasticsearch`**. The old `NEST` client is deprecated — don't start a new project with it. The client's major version must match your cluster (8.x client for an 8.x cluster, 9.x for 9.x).

```sql
dotnet add package Elastic.Clients.Elasticsearch
```

### The document and the client

```csharp
public sealed class OrderDocument
{
    public int OrderId { get; set; }
    public string CustomerName { get; set; } = "";
    public string City { get; set; } = "";
    public string Status { get; set; } = "";
    public string? Notes { get; set; }
    public decimal Total { get; set; }
    public DateTime OrderDate { get; set; }
}
```

```csharp
builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<IOptions<ElasticOptions>>().Value;

    var settings = new ElasticsearchClientSettings(new Uri(options.Url))
        .Authentication(new ApiKey(options.ApiKey))
        .DefaultIndex("orders");             // the alias, see below

    return new ElasticsearchClient(settings);
});
```

The client is thread-safe and keeps its connections: register it as a **singleton**. Property names are camel-cased automatically (`CustomerName` → `customerName`).

### Bulk indexing from SQL Server (with Dapper)

```csharp
public async Task IndexAllAsync(CancellationToken ct)
{
    using var connection = _db.Create();

    var orders = await connection.QueryAsync<OrderDocument>(@"
        SELECT o.Id AS OrderId, c.Name AS CustomerName, c.City, o.Status, o.Notes, o.Total, o.OrderDate
        FROM Orders o JOIN Customers c ON c.Id = o.CustomerId");

    foreach (var batch in orders.Chunk(5000))
    {
        var response = await _client.BulkAsync(b => b
            .Index("orders")
            .IndexMany(batch, (op, doc) => op.Id(doc.OrderId)), ct);

        if (response.Errors)
            foreach (var item in response.ItemsWithErrors)
                _logger.LogError("Failed to index {Id}: {Error}", item.Id, item.Error?.Reason);
    }
}
```

`op.Id(doc.OrderId)` uses the SQL key as `_id` — running it twice doesn't create duplicates. And always check `response.Errors`: a bulk request can "succeed" while some documents failed.

For millions of rows, don't load everything in memory: use Dapper's `buffered: false`, or read by ranges of ids. (In the next post, we'll do this sync without writing any code.)

### Searching

```csharp
public async Task<SearchResult> SearchAsync(string text, int page, CancellationToken ct)
{
    var response = await _client.SearchAsync<OrderDocument>(s => s
        .From(page * 20)
        .Size(20)
        .Query(q => q.Bool(b => b
            .Must(m => m.MultiMatch(mm => mm
                .Query(text)
                .Fields(new[] { "customerName^3", "notes" })
                .Fuzziness(new Fuzziness("AUTO"))))
            .Filter(
                f => f.Term(t => t.Field(d => d.Status).Value("Paid")),
                f => f.Range(r => r.DateRange(dr => dr.Field(d => d.OrderDate).Gte("now-90d/d"))))))
        .Aggregations(a => a.Add("by_city", agg => agg.Terms(t => t.Field(d => d.City).Size(10)))), ct);

    if (!response.IsValidResponse)
        throw new InvalidOperationException($"Search failed: {response.ElasticsearchServerError?.Error?.Reason}");

    var cities = response.Aggregations!.GetStringTerms("by_city")!.Buckets
        .Select(b => new CityCount(b.Key.ToString()!, b.DocCount));

    return new SearchResult(response.Total, response.Documents, cities);
}
```

The fluent syntax maps one-to-one to the JSON above — write and test the query in Kibana first, then translate it. (Small details of the fluent API changed between the 8.x and 9.x clients; if a method name doesn't compile, check the client version you're using.)

---

## Aliases & zero-downtime reindex

You can't change the type of an existing field. A new analyzer, `keyword` instead of `text`... you need a **new index** and a reindex. If your app talks to `orders_v1` directly, that means downtime. So the app always uses an **alias**:

```json
POST _aliases
{ "actions": [ { "add": { "index": "orders_v1", "alias": "orders" } } ] }
```

To change the mapping:

```sql
1. PUT orders_v2 { ...new mapping... }
2. POST _reindex { "source": { "index": "orders_v1" }, "dest": { "index": "orders_v2" } }
3. Switch the alias — atomically
4. Delete orders_v1 when you're sure
```

```json
POST _aliases
{
  "actions": [
    { "remove": { "index": "orders_v1", "alias": "orders" } },
    { "add":    { "index": "orders_v2", "alias": "orders" } }
  ]
}
```

Both actions run as **one atomic operation**: there's no moment where `orders` points to nothing. The app never knew anything happened.

For a big index, run `_reindex` with `?wait_for_completion=false` — it returns a task id you can follow with `GET _tasks/<id>`. Writes arriving during the reindex must go to the new index too (or be replayed after) — another reason to have a sync process you can re-run.

---

## Key rules to remember

| Rule | Why |
|---|---|
| SQL Server is the truth, Elasticsearch is a rebuildable read model | You can always reindex from the source |
| Define mappings yourself, use `"dynamic": "strict"` | No guessed types, no fields created by typos |
| `text` for search, `keyword` for filters/sort/aggs | Each type is built for one job |
| Add `lowercase` + `asciifolding` for user text | Accents and case don't block matches |
| User input in `must`, yes/no conditions in `filter` | Correct scoring, cached filters |
| Never `term` on a `text` field | The stored words are analyzed, your value is not |
| Use the SQL key as `_id` | Re-indexing is idempotent |
| Bulk in batches, always check `response.Errors` | A bulk can partially fail |
| `Elastic.Clients.Elasticsearch` as a singleton, same major version as the cluster | NEST is deprecated |
| The app talks to an alias, never to a versioned index | Reindex and switch with zero downtime |

>
> ## That's it & see you soon!.
>
