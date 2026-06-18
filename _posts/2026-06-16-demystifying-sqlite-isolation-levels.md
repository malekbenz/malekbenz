---
layout: post
title: "Demystifying SQLite Isolation Levels ,Concurrency and Gotchas"
date: 2026-06-17
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL', 'SQLITE']
categories: ['SQLITE']
description: 'Demystifying SQLite Isolation Levels , Concurrency, and Gotchas'
image: /images/helloweb/web.png
---

When developers transition from client-server database systems like PostgreSQL or Sql server to SQLite, they often bring assumptions about transaction isolation that do not align with SQLite internal architecture.

SQLite is single-file database, it delivers robust ACID compliance. However, its isolation model is based on  its file-locking mechanisms and journaling modes.

In this post we gonna breaks down how SQLite handles isolation, the critical distinction between transaction modes and isolation levels, and how to design your application to prevent concurrency issues like the dreaded `SQLITE_BUSY` error.

---

## 1. Standard ANSI SQL Isolation Levels vs. SQLite

The ANSI SQL standard defines four traditional isolation levels, characterized by the concurrency anomalies they prevent:

| Isolation Level | Dirty Reads | Non-Repeatable Reads | Phantom Reads | SQLite Implementation |
| :--- | :--- | :--- | :--- | :--- |
| **Read Uncommitted** | Allowed | Allowed | Allowed | Supported *only* via Shared Cache + Pragma |
| **Read Committed** | Prevented | Allowed | Allowed | N/A (SQLite skips directly to higher safety) |
| **Repeatable Read** | Prevented | Prevented | Allowed | N/A (SQLite skips directly to higher safety) |
| **Serializable** | Prevented | Prevented | Prevented | **Default Behavior (Global Across Connections)** |

### The Core Rule of SQLite Isolation

By default, **all transactions in SQLite are `SERIALIZABLE`**.

In a traditional client-server database, serializability is achieved using complex row-level or page-level locks ..etc

SQLite takes a far simpler approach: **It serializes writes at the database level [file].** There can only be **one writer** to an SQLite database file at any given moment. Because multiple concurrent write transactions cannot coexist, anomalies like dirty writes, lost updates, and write skew are structurally impossible across separate connections.

---

## 2. The Concurrency : Rollback Journal vs. WAL Mode

While SQLite guarantees serializability in both modes, how it achieves this isolation depends heavily on your `PRAGMA journal_mode`.

### A: Rollback Journal Mode

In standard rollback journal modes (`DELETE`, `TRUNCATE`, `PERSIST`), SQLite manages concurrency using a 5-state file locking mechanism:

1. **UNLOCKED:** No locks held. The database can be neither read nor written.
2. **SHARED:** Multiple connections can hold a `SHARED` lock simultaneously. You can read, but no one can write.
3. **RESERVED:** A connection holds this when it plans to modify the database in the future. Only one `RESERVED` lock can exist at a time, but existing `SHARED` locks (readers) can continue readin[...]
4. **PENDING:** The writer is waiting for all active `SHARED` locks to clear so it can write. No new readers are allowed to enter.
5. **EXCLUSIVE:** The writer has full, exclusive control. No other connection can read or write.

**Consequence:** Readers block writers, and writers block readers. If a transaction is writing, all other connections are completely locked out from reading until the transaction commits or rolls back.

### B: Write-Ahead Logging (WAL) Mode (The Modern Standard)

When you enable WAL mode (`PRAGMA journal_mode=WAL;`), SQLite alters its concurrency model. Instead of writing modifications directly to the main database file, changes are appended to a separate  `-wal` file.

* **Readers do not block writers.**
* **Writers do not block readers.**

**How Isolation Works under WAL:**
When a connection opens a read transaction under WAL mode, it queries the WAL index (`-shm` file) to determine the exact end of the log at that instant. This gives the reader a fixed, immutable **Snapshot Isolation** view of the database.

If another connection commits a massive write transaction five seconds later, those changes are appended to the WAL file, but the active reader remains completely isolated, seeing only the data as it existed when its transaction began.

---

## 3. Transaction Modes: The #1 Source of Confusion

Many developers mistake SQLite's transaction modes for isolation levels. Commands like `BEGIN DEFERRED` or `BEGIN IMMEDIATE` do not change *what* data is visible; instead, they define **when locks are acquired**.

SQLite supports three transaction startup modes:

```sql
BEGIN DEFERRED;  -- The implicit default
BEGIN IMMEDIATE;
BEGIN EXCLUSIVE;

```

### 1. DEFERRED (The Default)

* **Behavior:** When you type `BEGIN;` or `BEGIN DEFERRED;`, SQLite does absolutely nothing to lock the file. It waits.
* **The Flow:** * The moment you execute your first `SELECT`, it acquires a `SHARED` lock.
* The moment you execute your first `INSERT` or `UPDATE`, it attempts to upgrade that lock to a `RESERVED` lock.


* **The Risk:** High probability of application deadlocks under concurrent write workloads.

### 2. IMMEDIATE

* **Behavior:** The moment you execute `BEGIN IMMEDIATE;`, SQLite instantly attempts to acquire a `RESERVED` lock.
* **The Flow:** If successful, it guarantees that no other connection can start a write transaction. However, other connections can still read the database (both in Rollback and WAL modes).
* **The Guarantee:** Once `BEGIN IMMEDIATE` succeeds, your transaction is guaranteed not to fail with an `SQLITE_BUSY` error during a later write operation.

### 3. EXCLUSIVE

* **Behavior:** It instantly attempts to acquire an `EXCLUSIVE` lock.
* **The Flow:** In rollback journal mode, it prevents any other connection from even reading the database. In WAL mode, its behavior mimics `IMMEDIATE` because readers read from snapshots and ignore the main database lock state.

---

## 4. The Anatomy of an `SQLITE_BUSY` Error

Understanding isolation in SQLite requires mastering the mechanics of lock upgrades. Let's look at a classic concurrency trap using the default `DEFERRED` mode.

### The Deadlock Scenario (Rollback Mode)

Imagine two parallel database connections (Connection A and Connection B) executing code simultaneously:

1. **Connection A:** Executing `BEGIN;` (Deferred, no locks acquired).
2. **Connection B:** Executing `BEGIN;` (Deferred, no locks acquired).
3. **Connection A:** Executing `SELECT * FROM users;` -> Acquires a **SHARED** lock.
4. **Connection B:** Executing `SELECT * FROM users;` -> Acquires a second, concurrent **SHARED** lock.
5. **Connection A:** Executing `UPDATE users SET status = 'active';` -> Attempts to upgrade to a **RESERVED** lock. This succeeds because no other connection has a reserved lock yet.
6. **Connection B:** Executing `UPDATE users SET status = 'pending';` -> Attempts to upgrade to a **RESERVED** lock. **FAILS!** Only one reserved lock can exist. Connection B receives  an `SQLITE_BUSY` error.
7. **Connection A:** Tries to commit. To commit, it must upgrade from `RESERVED` -> `PENDING` -> `EXCLUSIVE`. It enters the `PENDING` state and waits for all `SHARED` locks to clear.
8. **The Deadlock:** Connection A is waiting for Connection B to release its `SHARED` lock. Connection B is stuck handling an `SQLITE_BUSY` error inside its uncommitted transaction, holding onto its `SHARED` lock.

![CMD](/images/sqlite-isolation/sqlite-dead-lock.png){:class="img-responsive" }

### The Solution: "Upfront" Locking

To eliminate this class of transaction failures, you must tell SQLite your intent immediately:

```sql
-- If your transaction will perform ANY write operation (INSERT, UPDATE, DELETE), 
-- ALWAYS start it with IMMEDIATE:
BEGIN IMMEDIATE;

```

By starting with `BEGIN IMMEDIATE`, Connection B would have failed or blocked at step 2, long before acquiring a `SHARED` lock that could cause a deadlock with Connection A.

---

## 5. Breaking Isolation: `READ UNCOMMITTED` Mode

There is exactly one way to drop SQLite's isolation below `SERIALIZABLE`. It requires a highly specific setup:

1. The database connections must reside within the **same process**.
2. **Shared Cache Mode** must be explicitly enabled at the database driver level.
3. The connection must explicitly toggle the read uncommitted pragma:

```sql
PRAGMA read_uncommitted = TRUE;

```

When these criteria are met, a `SELECT` statement on Connection A can read data that has been modified by Connection B inside a transaction, *before* Connection B has issued a `COMMIT`. If Connection B performs a `ROLLBACK`, Connection A has officially performed a **Dirty Read**.

*Note: For almost all modern web and desktop applications, Shared Cache mode is discouraged, and lowering the isolation level is unnecessary.*

---

## 6. What You Must Understand

To build applications with SQLite, keep these rules in mind:

1. **Isolation within the same connection is non-existent:** Isolation only exists *between distinct connections*.
2. **Always Use WAL Mode:** Unless you are running on a network filesystem (which WAL doesn't support due to shared-memory architecture limitations), always use `PRAGMA journal_mode=WAL;`. It decouples readers from writers and mimics standard production databases.
3. **Match Your `BEGIN` to Your Intent:** * Use default `BEGIN` (`DEFERRED`) only for purely read-only transactions.

   * Use `BEGIN IMMEDIATE` for any transaction that modifies data.

4. **Handle `SQLITE_BUSY` Gracefully:** Configure a busy timeout (`PRAGMA busy_timeout = 5000;`) so that SQLite will automatically retry acquiring locks for up to 5000ms before throwing an error [...]
5. **SQLite is a Single-Writer DB:** No matter how many threads or processes you throw at it, write operations must take turns. Design your long-running processes around short, atomic transactions to keep the write lock available.

## 6.  Dotnet example

```c#
using Microsoft.Data.Sqlite;
using Dapper;

public class UserRepository
{
    private readonly string _connectionString = "Data Source=myapp.db;Cache=Shared;";

    public void DoWork()
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();

        // Apply all PRAGMAs immediately after opening
        InitializePragmas(connection);

        // ... your Dapper queries here ...
    }

    private void InitializePragmas(SqliteConnection connection)
    {
        // 1. Enable Write-Ahead Logging
        connection.Execute("PRAGMA journal_mode=WAL;");
        
        // 2. Set Busy Timeout (Waits up to 5000ms / 5 seconds for locks)
        connection.Execute("PRAGMA busy_timeout = 5000;"); 
        
        // 3. Recommended performance/safety settings for WAL
        connection.Execute("PRAGMA synchronous=NORMAL;");
        connection.Execute("PRAGMA foreign_keys=ON;");
    }
}

```

>
> ## That's it & see you soon!.
>
