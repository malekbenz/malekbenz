---
layout: post
title: "Sqlite WAL — Write-Ahead Log ,- The What, The Why, and The When"
date: 2026-06-16
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL', 'SQLITE']
categories: ['SQLITE']
description: 'Sqlite WAL — Write-Ahead Log ,- The What, The Why, and The When'
image: /images/helloweb/web.png
---


If you've ever seen `database is locked` in a concurrent .NET app using SQLite, WAL mode is probably the fix you're looking for. Let's break down how it works, why it matters, and when to use it.

In this tutorial we are going to try to understand and break down sqlite journal-mode `WAL` how it works and why we should use it.

## The core idea

In classic SQLite (rollback journal mode), to modify a page:

1. Copy the **original page** to a journal file (for rollback safety)
2. Write the **new page** directly into the database file

WAL flips this completely:

> **Never modify the database file directly. Instead, append all changes to a separate log file.**

---

## The three files

When WAL is enabled, SQLite works with three files:

``` sql
myapp.db        — the main database (mostly untouched during writes)
myapp.db-wal    — the write-ahead log (all new changes go here)
myapp.db-shm    — shared memory index (helps readers find pages in WAL)
```

---

## How a write works

```sql
Writer says: "UPDATE users SET name='Malek' WHERE id=1"

1. SQLite finds page X (which contains that row) in myapp.db
2. Does NOT touch myapp.db
3. Appends the modified page X to myapp.db-wal
4. Transaction committed — done
```

The database file is untouched. The WAL file just keeps growing with new page versions appended at the end.

---

## How a read works

This is the clever part. When a reader wants page X:

```sql
1. Check myapp.db-wal — is there a newer version of page X here?
   YES → use that version
   NO  → read from myapp.db as normal
```

Each reader gets a **consistent snapshot** of the database at the moment their transaction started. Even if a writer appends new changes to the WAL mid-read, the reader ignores them (it knows its snapshot point).

This is why **readers never block writers and writers never block readers.**

```sql
Timeline:

Reader A starts  ──────────────────────────────► reads pages 1,2,3
                         Writer commits (page 2 updated)
                         
Reader A still sees the OLD page 2 — its snapshot is frozen at start time
Reader B starts after the commit → sees the NEW page 2
```

---

## The checkpoint — WAL back to DB

The WAL file can't grow forever. Eventually SQLite must copy WAL pages back into the main database file. This is called a **checkpoint**.

```sql
myapp.db-wal  ──(checkpoint)──►  myapp.db
```

Checkpoint happens automatically when WAL reaches **1000 pages** (~4MB with default page size).

During checkpoint:

- Writers are **paused**
- Active readers are **waited on** (checkpoint won't overwrite pages a reader still needs)
- Once all readers finish their snapshots, pages are copied back

This is why you can get **periodic latency spikes** under load — a checkpoint kicked in.

---

## Visualizing the full flow

```sql
Initial state:
  myapp.db  [page1 v1] [page2 v1] [page3 v1]
  myapp.db-wal  (empty)

Writer 1 commits:
  myapp.db  [page1 v1] [page2 v1] [page3 v1]   ← unchanged
  myapp.db-wal  [page2 v2]

Writer 2 commits:
  myapp.db  [page1 v1] [page2 v1] [page3 v1]   ← unchanged
  myapp.db-wal  [page2 v2] [page1 v2]

Checkpoint triggers:
  myapp.db  [page1 v2] [page2 v2] [page3 v1]   ← updated
  myapp.db-wal  (reset)
```

---

## Why WAL is faster for most workloads

| Operation | Rollback Journal | WAL |
|---|---|---|
| Write | Random write to DB file | Sequential append to WAL |
| Read | Read DB file | Read WAL or DB file |
| Commit | Flush journal + DB file | Flush WAL only |
| Concurrent reads during write | ❌ Blocked | ✅ Free |

Sequential appends to WAL are much faster than random writes into the database file, especially on spinning disks and many SSDs.

---

## The one WAL weakness

WAL is slightly slower when the WAL file is very large and a reader must scan far back through it to find the right page version. This is another reason to let checkpoints happen regularly — keep the WAL small.

Also, WAL requires the three files (`db`, `db-wal`, `db-shm`) to always stay together. If you copy just `myapp.db` without the WAL file, you may get an inconsistent snapshot.

## Using WAL + SQLite with Dapper in .NET

### Setup & connection factory

First, a proper connection factory that applies all the right PRAGMAs:

```csharp
public interface IDbConnectionFactory
{
    SqliteConnection CreateConnection();
}

public class SqliteConnectionFactory : IDbConnectionFactory
{
    private readonly string _connectionString;
    private static bool _walInitialized = false;
    private static readonly Lock _initLock = new();

    public SqliteConnectionFactory(string connectionString)
    {
        _connectionString = connectionString;
    }

    public SqliteConnection CreateConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        ApplyPragmas(connection);
        return connection;
    }

    private void ApplyPragmas(SqliteConnection connection)
    {
        connection.Execute("""
            PRAGMA journal_mode=WAL;
            PRAGMA busy_timeout=5000;
            PRAGMA synchronous=NORMAL;
            PRAGMA cache_size=-64000;
            PRAGMA foreign_keys=ON;
        """);
    }
}
```

Register in DI:

```csharp
// Program.cs
builder.Services.AddSingleton<IDbConnectionFactory>(_ =>
    new SqliteConnectionFactory("Data Source=myapp.db"));
```

---

### Basic repository pattern

```csharp
public class UserRepository
{
    private readonly IDbConnectionFactory _factory;

    public UserRepository(IDbConnectionFactory factory)
    {
        _factory = factory;
    }

    // READ — open, query, close immediately
    public async Task<User?> GetByIdAsync(int id)
    {
        using var conn = _factory.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Id = @Id",
            new { Id = id });
    }

    public async Task<IEnumerable<User>> GetAllAsync()
    {
        using var conn = _factory.CreateConnection();
        return await conn.QueryAsync<User>("SELECT * FROM Users");
    }

    // WRITE — short transaction, commit fast
    public async Task<int> InsertAsync(User user)
    {
        using var conn = _factory.CreateConnection();
        return await conn.ExecuteScalarAsync<int>("""
            INSERT INTO Users (Name, Email, CreatedAt)
            VALUES (@Name, @Email, @CreatedAt);
            SELECT last_insert_rowid();
            """,
            user);
    }

    public async Task UpdateAsync(User user)
    {
        using var conn = _factory.CreateConnection();
        await conn.ExecuteAsync("""
            UPDATE Users 
            SET Name = @Name, Email = @Email 
            WHERE Id = @Id
            """,
            user);
    }
}
```

---

### Transactions with Dapper

```csharp
public async Task TransferAsync(int fromId, int toId, decimal amount)
{
    using var conn = _factory.CreateConnection();
    
    // Use BEGIN IMMEDIATE to grab the write lock upfront
    // avoids deadlock when two transactions try to upgrade from read to write
    await conn.ExecuteAsync("BEGIN IMMEDIATE;");
    
    try
    {
        var from = await conn.QuerySingleAsync<Account>(
            "SELECT * FROM Accounts WHERE Id = @Id", new { Id = fromId });

        if (from.Balance < amount)
            throw new InvalidOperationException("Insufficient balance.");

        await conn.ExecuteAsync( "UPDATE Accounts SET Balance = Balance - @Amount WHERE Id = @Id",
            new { Amount = amount, Id = fromId });

        await conn.ExecuteAsync( "UPDATE Accounts SET Balance = Balance + @Amount WHERE Id = @Id",
            new { Amount = amount, Id = toId });

        await conn.ExecuteAsync("COMMIT;");
    }
    catch
    {
        await conn.ExecuteAsync("ROLLBACK;");
        throw;
    }
}
```

Or using Dapper's built-in transaction support:

```csharp
public async Task TransferAsync(int fromId, int toId, decimal amount)
{
    using var conn = _factory.CreateConnection();
    using var tx = conn.BeginTransaction();

    try
    {
        await conn.ExecuteAsync( "UPDATE Accounts SET Balance = Balance - @Amount WHERE Id = @Id",
            new { Amount = amount, Id = fromId }, tx);
        await conn.ExecuteAsync( "UPDATE Accounts SET Balance = Balance + @Amount WHERE Id = @Id",
            new { Amount = amount, Id = toId }, tx);
        tx.Commit();
    }
    catch
    {
        tx.Rollback();
        throw;
    }
}
```

---

### Bulk insert — the right way

```csharp
// Bad — 1000 round trips, 1000 separate WAL appends
foreach (var user in users)
    await repo.InsertAsync(user);

// Good — one transaction, one WAL append
public async Task BulkInsertAsync(IEnumerable<User> users)
{
    using var conn = _factory.CreateConnection();
    using var tx = conn.BeginTransaction();

    await conn.ExecuteAsync("""
        INSERT INTO Users (Name, Email, CreatedAt)
        VALUES (@Name, @Email, @CreatedAt)
        """,
        users,   
        tx);

    tx.Commit();
}
```

This executes all inserts inside a single transaction — one WAL append, one commit, dramatically faster.

---

### Handling `SQLITE_BUSY` with retry

Even with `busy_timeout=5000`, under extreme contention you may still want a retry policy. Use Polly:

```csharp
// Program.cs
builder.Services.AddResiliencePipeline("sqlite", pipeline =>
{
    pipeline.AddRetry(new RetryStrategyOptions
    {
        ShouldHandle = new PredicateBuilder()
            .Handle<SqliteException>(ex => ex.SqliteErrorCode == 5), // SQLITE_BUSY
        MaxRetryAttempts = 3,
        Delay = TimeSpan.FromMilliseconds(100),
        BackoffType = DelayBackoffType.Exponential
    });
});
```

Then in your repository:

```csharp
public class UserRepository
{
    private readonly IDbConnectionFactory _factory;
    private readonly ResiliencePipeline _resilience;

    public UserRepository(
        IDbConnectionFactory factory,
        ResiliencePipelineProvider<string> pipelineProvider)
    {
        _factory = factory;
        _resilience = pipelineProvider.GetPipeline("sqlite");
    }

    public async Task InsertAsync(User user)
    {
        await _resilience.ExecuteAsync(async ct =>
        {
            using var conn = _factory.CreateConnection();
            await conn.ExecuteAsync( "INSERT INTO Users (Name, Email) VALUES (@Name, @Email)", user);
        });
    }
}
```

---

### Key rules to remember

| Rule | Why |
|---|---|
| Always `using var conn` | Return connection to pool immediately |
| Keep transactions short | Don't hold the write lock longer than needed |
| Use `BEGIN IMMEDIATE` for multi-step writes | Avoids read-to-write lock upgrade deadlocks |
| Batch inserts in one transaction | Dramatically faster WAL appends |
| Set `busy_timeout` | Prevents instant `SQLITE_BUSY` failures |
| Never `await` across an open connection unnecessarily | Holds the connection open too long |

>
> ## That's it & see you soon!.
>
