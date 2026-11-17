---
layout: post
title: "Logstash with examples - From SQL Server to Elasticsearch"
date: 2025-12-10
author: Malekbenz
comments: true
category: elasticsearch
tags : [ 'elasticsearch', 'logstash', 'SQL', 'SQLSERVER']
categories: ['elasticsearch', 'SQLSERVER']
description: 'Logstash with examples - From SQL Server to Elasticsearch'
image: /images/covers/logstash-with-examples-sql-server-to-elasticsearch.png
---

A few years ago, on a big project, I had to make several million records from a SQL Server database searchable — in French **and** Arabic — on a 3-node Elasticsearch cluster. No C# sync service: about **25 Logstash pipelines**, each one a small configuration file. In the [last post](/blog/2025/11/12/elasticsearch-for-dotnet-developers) we pushed documents with C#; today I'll show how Logstash does it, with the patterns that worked for me in production — and the mistakes my Git history still remembers ("fix big to int", "fix conversion issue", "fix time limit"...).

## The core idea: input → filter → output

Logstash is a data pipeline. Every pipeline has three parts:

```sql
 ┌─────────┐      ┌──────────┐      ┌───────────────┐
 │  INPUT  │ ───► │  FILTER  │ ───► │    OUTPUT     │
 └─────────┘      └──────────┘      └───────────────┘
  jdbc (SQL)       mutate            elasticsearch
  file, beats      jdbc_static       stdout (debug)
  http, kafka      date, grok        file, http...
```

Each row (or log line) becomes an **event**, filters change it, outputs send it. Everything lives in a `.conf` file:

```ruby
input  { ... }
filter { ... }
output { ... }
```

> **SQL Server stays the source of truth. Logstash only moves and shapes the data; Elasticsearch is a read model you can rebuild at any time.**

The examples below use a neutral model: a `customers` index where **one document = one customer**, built from several tables.

---

## Example 1 — The main pipeline

### Driver, connection, schedule

```ruby
# pipelines/customers-main.conf
input {
  jdbc {
    jdbc_driver_library    => "/usr/share/logstash/drivers/mssql-jdbc-<version>.jre11.jar"
    jdbc_driver_class      => "com.microsoft.sqlserver.jdbc.SQLServerDriver"
    jdbc_connection_string => "jdbc:sqlserver://sql-server:1433;databaseName=Shop;encrypt=true;trustServerCertificate=true"
    jdbc_user              => "logstash_reader"
    jdbc_password          => "${SQL_PASSWORD}"

    schedule               => "*/5 * * * *"          # every 5 minutes
    lowercase_column_names => false                  # keep "CustomerName", not "customername"

    use_column_value       => true
    tracking_column        => "RowVersionNum"
    tracking_column_type   => "numeric"
    last_run_metadata_path => "/usr/share/logstash/data/customers-main.last_run"

    statement => "
      SELECT TOP 1000
             c.CustomerId                         AS Id,
             UPPER(c.LastName)                    AS LastName,
             UPPER(c.FirstName)                   AS FirstName,
             c.LastNameAr, c.FirstNameAr,
             TRY_CONVERT(int, city.Code)          AS CityCode,
             city.Code + '- ' + city.Name         AS City,
             REPLACE(c.CustomerNumber, '/', '-')  AS CustomerNumber,
             CASE c.Status WHEN 1 THEN 'Active'  WHEN 2 THEN 'Suspended' ELSE 'Closed' END AS Status,
             CASE c.Status WHEN 1 THEN N'نشط'    WHEN 2 THEN N'معلق'     ELSE N'مغلق'  END AS StatusAr,
             c.PreferredCategoryId,
             c.CreatedAt,
             CONVERT(bigint, c.RowVersion)        AS RowVersionNum
      FROM Customers c
      JOIN Cities city ON city.CityId = c.CityId
      WHERE CONVERT(bigint, c.RowVersion) > :sql_last_value
        AND c.RowVersion < MIN_ACTIVE_ROWVERSION()
      ORDER BY c.RowVersion"
  }
}
```

A lot of real experience is hidden in this `SELECT`:

- **`CONVERT(bigint, RowVersion)`**: the `ROWVERSION` column (see the [optimistic concurrency post](/blog/2025/06/11/sqlserver-optimistic-concurrency-rowversion-dapper)) changes on every update. Converted to `bigint`, it's a perfect numeric tracking column: Logstash stores the biggest value in `last_run_metadata_path`, and the next run only reads rows changed since.
- **`TOP 1000` + `ORDER BY`**: the first run doesn't read 5 million rows at once. It takes 1,000, saves the last value, and continues 5 minutes later. A big backlog is **caught up progressively**, without killing the production database.
- **Labels in both languages, built in SQL** (`Status` / `StatusAr`): the search page shows the right language without any lookup on the client side.
- **Data cleaning at the source**: `TRY_CONVERT` returns `NULL` instead of failing on a dirty code, `UPPER` normalizes names, `REPLACE('/', '-')` removes slashes from identifiers that end up in URLs and filters.

**Why `MIN_ACTIVE_ROWVERSION()`?** It's the improvement I'd add today. A transaction gets its rowversion when it **writes**, but becomes visible when it **commits**. Without this condition, a long transaction can commit a rowversion *lower* than the one Logstash already saved — and that row is never synced. `MIN_ACTIVE_ROWVERSION()` is the lowest rowversion still used by an open transaction; reading only below it means we never jump over an uncommitted change.

### The output

```ruby
filter {
  mutate { remove_field => ["@version", "@timestamp"] }
}

output {
  elasticsearch {
    hosts         => ["https://es-node1:9200", "https://es-node2:9200", "https://es-node3:9200"]
    api_key       => "${ES_API_KEY}"
    index         => "customers"            # an alias
    document_id   => "%{Id}"                # SQL key = _id
    action        => "update"
    doc_as_upsert => true
  }
}
```

- **All 3 nodes** in `hosts`: Logstash balances the requests and keeps working if a node is down.
- **`document_id` = the SQL key**: a re-sync replaces, it never duplicates.
- **`action => "update"` + `doc_as_upsert => true`**: "create the document if it doesn't exist, otherwise **merge** these fields into it". This is the key to the next pattern.

---

## Example 2 — Many pipelines, ONE document

A customer document needs data from many tables: profile, current status, loyalty card, preferences... One giant `SELECT` with 15 joins is slow, hard to maintain, and re-reads everything when one small table changes. In my project, the solution was **one pipeline per source**, all writing to the **same document id**:

```sql
customers-main.conf     → Id, names, city, status...      ┐
customers-status.conf   → CurrentStatus, StatusDate        ├──► customers/_doc/{Id}   (one document)
customers-loyalty.conf  → LoyaltyLevel, Points             │
customers-prefs.conf    → PreferredCategory...             ┘
```

```ruby
# pipelines/customers-loyalty.conf (output part)
output {
  elasticsearch {
    hosts         => ["https://es-node1:9200", "https://es-node2:9200", "https://es-node3:9200"]
    api_key       => "${ES_API_KEY}"
    index         => "customers"
    document_id   => "%{Id}"          # the SAME id as the main pipeline
    action        => "update"
    doc_as_upsert => true             # only LoyaltyLevel and Points are merged
  }
}
```

Each pipeline only sends **its** fields; `update` merges them, so pipelines never erase each other's data. And because of `doc_as_upsert`, the order doesn't matter: if the loyalty pipeline runs before the main one, it creates a partial document that the main pipeline completes later.

Each pipeline also has its own schedule and its own tracking value — a table that changes every minute doesn't force a re-read of the tables that change once a day.

---

## Example 3 — Tracking a status history table (timestamp)

Not every table has a `ROWVERSION`. Status changes, for example, are often stored as a **history**: one row per change, with a date and an "is current" flag. Then the tracking column is a **date**:

```ruby
# pipelines/customers-status.conf
input {
  jdbc {
    # ... driver and connection ...
    schedule               => "* 20-23 * * *"         # every minute, but only between 20:00 and 23:59
    use_column_value       => true
    tracking_column        => "StatusDate"
    tracking_column_type   => "timestamp"
    plugin_timezone        => "local"
    last_run_metadata_path => "/usr/share/logstash/data/customers-status.last_run"
    lowercase_column_names => false

    statement => "
      SELECT TOP 50000
             h.CustomerId  AS Id,
             h.Date        AS StatusDate,
             h.Status      AS CurrentStatusCode,
             CASE h.Status WHEN 1 THEN 'Active' WHEN 2 THEN 'Suspended' ELSE 'Closed' END AS CurrentStatus
      FROM CustomerStatusHistory h
      WHERE h.Date > :sql_last_value
        AND h.IsCurrent = 1
      ORDER BY h.Date"
  }
}
```

Three lessons from this one:

**1. Timezones.** By default, `:sql_last_value` is handled in **UTC**. If your `DATETIME` columns store the server's **local** time, the comparison is shifted by your UTC offset: you re-read hours of data, or worse, skip them. `plugin_timezone => "local"` keeps `:sql_last_value` in local time, like the column. (Even better: store dates in UTC in the database.)

**2. `TOP N` with dates has a trap: ties.** If 70,000 rows share the same `Date` and you read `TOP 50000`, the saved value is that date — and `> :sql_last_value` skips the 20,000 others. Solutions: a tracking value that's unique (rowversion is), a bigger `TOP`, or `>=` (safe here because the upsert is idempotent — but then `TOP` must be larger than the biggest group of identical dates, or the pipeline reads the same rows forever).

**3. Schedules protect production.** Light, incremental pipelines run every 5 minutes. Heavy ones (big history tables, first loads) run **off-peak**: `"* 20-23 * * *"` means every minute, but only in the evening. The schedule is cron syntax with an optional 6th field for seconds (`"*/30 * * * * *"`).

---

## Example 4 — Enrichment from another database with jdbc_static

Sometimes a label lives in **another database**: here, category names (in Arabic) come from the catalog database, not from the customers database. You can't join across servers in the `SELECT`, and querying the catalog for each event would be slow. The `jdbc_static` filter loads lookup tables **once** into a local in-memory database, then joins each event locally:

```ruby
filter {
  jdbc_static {
    jdbc_driver_library    => "/usr/share/logstash/drivers/mssql-jdbc-<version>.jre11.jar"
    jdbc_driver_class      => "com.microsoft.sqlserver.jdbc.SQLServerDriver"
    jdbc_connection_string => "jdbc:sqlserver://catalog-server:1433;databaseName=Catalog;encrypt=true;trustServerCertificate=true"
    jdbc_user              => "logstash_reader"
    jdbc_password          => "${CATALOG_SQL_PASSWORD}"

    loaders => [
      {
        id          => "remote-categories"
        query       => "SELECT CategoryId, NameAr FROM dbo.Categories"
        local_table => "categories"
      }
    ]
    local_db_objects => [
      {
        name          => "categories"
        index_columns => ["CategoryId"]
        columns       => [ ["CategoryId", "varchar(50)"], ["NameAr", "varchar(500)"] ]
      }
    ]
    local_lookups => [
      {
        id         => "local-categories"
        query      => "SELECT NameAr FROM categories WHERE CategoryId = :id"
        parameters => { id => "[PreferredCategoryId]" }
        target     => "category_lookup"
      }
    ]

    # The lookup result is an array of rows, and the column names come back in LOWERCASE
    add_field    => { "PreferredCategoryAr" => "%{[category_lookup][0][namear]}" }
    remove_field => ["category_lookup"]

    loader_schedule => "0 */6 * * *"     # refresh the lookup tables every 6 hours
  }
}
```

The detail that cost me time: in `local_lookups` results, column names are **lowercase** — `NameAr` becomes `namear`. Write `[category_lookup][0][NameAr]` and you get the literal text `%{[category_lookup][0][NameAr]}` in your documents.

---

## Two languages: French + Arabic analyzers

Searching French and Arabic text needs **different analyzers**: French removes accents and plural forms ("ingénieurs" → "ingenieur"), Arabic normalizes letters and removes prefixes. Test them first with `_analyze` (I kept a `.rest` file with these requests next to the pipelines):

```json
POST _analyze
{ "analyzer": "french", "text": "Ingénieurs en informatique" }

POST _analyze
{ "analyzer": "arabic", "text": "مهندسون في الإعلام الآلي" }
```

Then let the index template choose the analyzer **by field name**: everything is French by default, and every field ending with `Ar` uses the Arabic analyzer:

```json
PUT _index_template/customers
{
  "index_patterns": ["customers_v*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "analysis": { "analyzer": { "default": { "type": "french" } } }
    },
    "mappings": {
      "dynamic_templates": [
        {
          "arabic_text": {
            "match": "*Ar",
            "match_mapping_type": "string",
            "mapping": { "type": "text", "analyzer": "arabic" }
          }
        }
      ],
      "properties": {
        "Id":             { "type": "keyword" },
        "CustomerNumber": { "type": "keyword" },
        "CityCode":       { "type": "integer" },
        "Status":         { "type": "keyword" },
        "CreatedAt":      { "type": "date" },
        "RowVersionNum":  { "type": "long" }
      }
    },
    "aliases": { "customers": {} }
  }
}
```

Note `RowVersionNum` as `long`: a rowversion converted to `bigint` doesn't fit in an `integer`. That's exactly the kind of "fix big to int" commit you want to avoid. Same for long identifiers (national numbers, phone numbers...): store them as **keyword**, not as numbers — you never do math on them, and you avoid overflow and lost leading zeros.

---

## pipelines.yml: one pipeline per source

```yaml
- pipeline.id: customers-main
  path.config: "/usr/share/logstash/pipeline/customers-main.conf"
  pipeline.workers: 1
  pipeline.batch.size: 125
  pipeline.batch.delay: 5

- pipeline.id: customers-status
  path.config: "/usr/share/logstash/pipeline/customers-status.conf"
  pipeline.workers: 1

- pipeline.id: customers-loyalty
  path.config: "/usr/share/logstash/pipeline/customers-loyalty.conf"
  pipeline.workers: 1
  queue.type: persisted
```

- **`pipeline.workers: 1`**: with several workers, two updates of the same customer can be sent in the wrong order. For a sync pipeline, order matters more than parallelism — and the JDBC input reads in one thread anyway.
- **Separate pipelines**: a slow or broken pipeline doesn't block the others, and each one can be restarted alone.
- **`queue.type: persisted`**: events wait on disk instead of memory, so a restart or an Elasticsearch outage doesn't lose them.

In `logstash.yml`, `config.reload.automatic: true` reloads a pipeline when you save its `.conf` file — very handy while tuning a `SELECT` on a test server.

---

## Lessons learned

| Problem I hit | What to do |
|---|---|
| Tracking value too big for `int` | `CONVERT(bigint, RowVersion)` in SQL, `long` in the mapping |
| A row is never synced | Read only `< MIN_ACTIVE_ROWVERSION()` |
| Hours of data re-read or skipped | `plugin_timezone => "local"` with local-time columns (or store UTC) |
| Rows skipped with `TOP N` on a date | Unique tracking values, or `>=` with an idempotent upsert |
| Conversion errors stop a run | `TRY_CONVERT` in SQL: `NULL` instead of failure |
| `/` in identifiers breaks URLs and filters | Normalize in SQL (`REPLACE`), store as keyword |
| Lookup field shows `%{[...][NameAr]}` | Lookup columns come back lowercase |
| Pipelines erase each other's fields | `action => "update"` + `doc_as_upsert => true` |
| The first load hurts the production DB | `TOP N` batches + off-peak schedules |
| Java version problems | Old Logstash versions needed a specific JDK; current versions ship with their own |

And if you've used Logstash with Elasticsearch 6, you'll remember `document_type` in the output and `type` fields to route events in one big config. Mapping types are gone since Elasticsearch 7–8 — today, use one index per kind of document and one pipeline per source.

---

## Debugging & running it

While writing a pipeline, test it on a **few known records** and look at the events before they reach the index:

```ruby
statement => "SELECT ... WHERE ... AND c.CustomerId IN ('id-1', 'id-2')"   # temporary filter

output {
  stdout { codec => rubydebug }
}
```

```sql
# Check the syntax without running anything
bin/logstash -f pipeline/customers-main.conf --config.test_and_exit

# Start again from zero: ignore the saved tracking value (remove it afterwards!)
clean_run => true

# Events in / out / failures per pipeline
curl -s "localhost:9600/_node/stats/pipelines?pretty"
```

Two settings to remember when things fail in production:

- **Dead letter queue** (`dead_letter_queue.enable: true`): documents rejected by Elasticsearch (a text in a date field, for example) are kept on disk with the reason, instead of being dropped.
- **Passwords**: `${SQL_PASSWORD}` reads an environment variable (or the Logstash keystore). In my early versions the credentials were in the `.conf` files — one more thing I'd do differently today.

---

## Key rules to remember

| Rule | Why |
|---|---|
| One pipeline per source table, one `document_id` per entity | Small queries, independent schedules |
| `action => "update"` + `doc_as_upsert => true` | Pipelines enrich the same document without erasing each other |
| Track `CONVERT(bigint, RowVersion)` + `< MIN_ACTIVE_ROWVERSION()` | Incremental sync that never skips a row |
| `TOP N` + `ORDER BY` the tracking column | Catch up big backlogs gently |
| Date tracking: watch timezones and ties | The two classic causes of missing data |
| Heavy pipelines off-peak (`schedule`) | The production database stays fast |
| `jdbc_static` for lookups from another DB | Cached locally, refreshed with `loader_schedule` |
| French default analyzer + `*Ar` dynamic template | Each language analyzed correctly |
| Identifiers as keyword, big numbers as long | No overflow, no lost zeros |
| `pipeline.workers: 1`, persisted queue, DLQ on | Ordered, durable, and rejected events kept |
| Secrets in `${ENV}` or the keystore | Never in the `.conf` files |
| Debug with a few IDs and `stdout { codec => rubydebug }` | See the events before they reach the index |

>
> ## That's it & see you soon!.
>
