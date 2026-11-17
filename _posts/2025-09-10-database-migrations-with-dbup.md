---
layout: post
title: "Database migrations with DbUp - Plain SQL scripts, the right way"
date: 2025-09-10
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL', 'SQLSERVER', '.Net', 'Dapper']
categories: ['SQLSERVER', '.Net']
description: 'Database migrations with DbUp - Plain SQL scripts, the right way'
image: /images/covers/database-migrations-with-dbup.png
---

"Did you run the script on the test server?" — "Which one, `update_v2_final.sql` or `update_v2_final_FIXED.sql`?" If your database changes live in a shared folder, in emails, or in somebody's head, sooner or later production and test won't have the same schema, and nobody will know why. When you use Dapper, you write SQL by hand anyway — so let's manage the schema with plain SQL scripts too, versioned in Git, applied automatically, exactly once, in order. That's what **DbUp** does.

## The core idea: a journal of executed scripts

DbUp is very simple, and that's its strength:

```sql
1. Find all the .sql scripts (embedded in your assembly)
2. Sort them by name
3. Read the journal table in the database: which scripts already ran?
4. Run only the new ones, in order
5. Write each executed script name in the journal
```

The journal is a normal table:

```sql
SELECT * FROM dbo.MigrationHistory;

-- Id | ScriptName                                          | Applied
-- 1  | MyApp.Database.Scripts.Schema.0001_Init.sql     | 2025-09-01 10:12:44
-- 2  | MyApp.Database.Scripts.Schema.0002_AddOrders.sql| 2025-09-03 16:40:02
```

Run DbUp on an empty database: everything runs. Run it again: nothing happens. Run it on a database that is two scripts behind: only those two run.

> **The rule: the scripts in Git are the truth. Every database — dev, test, production — is just "the scripts applied up to some point".**

---

## Project layout

Put the scripts in their own class library, so the API, the migrator and the tests can share them:

```sql
MyApp.Database/
├── MyApp.Database.csproj
├── DatabaseAssemblyMarker.cs              ← empty class, just to find the assembly
├── DatabaseUpgrader.cs
└── Scripts/
    ├── Schema/
    │   ├── 0001_Init.sql
    │   ├── 0002_AddOrders.sql
    │   └── 0003_AddOrders_RowVersion.sql
    └── ReferenceData/
        ├── 0001_Statuses.sql
        └── 0002_DefaultSettings.sql
```

Embed the scripts in the DLL, so you deploy **one file** instead of a folder of scripts that can go missing:

```xml
<ItemGroup>
  <EmbeddedResource Include="Scripts\**\*.sql" />
</ItemGroup>

<ItemGroup>
  <PackageReference Include="dbup-sqlserver" Version="..." />   <!-- latest stable from NuGet -->
</ItemGroup>
```

DbUp has one package per database: `dbup-sqlserver`, `dbup-sqlite`, `dbup-postgresql`... The all-in-one `dbup` package also works, but it brings providers you don't need.

```csharp
// Only used to get the assembly: typeof(DatabaseAssemblyMarker).Assembly
public sealed class DatabaseAssemblyMarker;
```

### Naming the scripts

DbUp sorts scripts by their **full resource name** (namespace + folders + file name), as plain text. So:

```sql
✅ 0001_Init.sql, 0002_AddOrders.sql ... 0010_AddIndex.sql      ← zero-padded: correct order
❌ 1_Init.sql, 2_AddOrders.sql ... 10_AddIndex.sql              ← "10_" sorts before "2_"
```

In a team, two developers can both create `0005_...` on two branches. A timestamp prefix avoids the collision:

```sql
202509101430_AddCustomerEmail.sql
```

---

## The migration runner

```csharp
public static class DatabaseUpgrader
{
    public static DatabaseUpgradeResult Run(string connectionString, Action<string>? log = null)
    {
        EnsureDatabase.For.SqlDatabase(connectionString);   // creates the DB if it doesn't exist

        var assembly = typeof(DatabaseAssemblyMarker).Assembly;

        var upgrader = DeployChanges.To
            .SqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(assembly,
                name => name.Contains(".Scripts.Schema."),
                new SqlScriptOptions { ScriptType = ScriptType.RunOnce, RunGroupOrder = 1 })
            .WithScriptsEmbeddedInAssembly(assembly,
                name => name.Contains(".Scripts.ReferenceData."),
                new SqlScriptOptions { ScriptType = ScriptType.RunAlways, RunGroupOrder = 2 })
            .JournalToSqlTable("dbo", "MigrationHistory")
            .WithTransactionPerScript()
            .WithExecutionTimeout(TimeSpan.FromMinutes(5))
            .LogToConsole()
            .Build();

        return upgrader.PerformUpgrade();
    }
}
```

Line by line:

| Call | What it does |
|---|---|
| `EnsureDatabase.For.SqlDatabase` | Creates the database if missing (great for dev and tests; in production the DBA usually creates it) |
| `WithScriptsEmbeddedInAssembly(..., filter, options)` | Which scripts, and how to run them |
| `ScriptType.RunOnce` | Normal migrations: run once, then journaled |
| `ScriptType.RunAlways` | Reference data: run on **every** deployment (so they must be idempotent) |
| `RunGroupOrder` | Migrations (group 1) always run before reference data (group 2) |
| `JournalToSqlTable("dbo", "MigrationHistory")` | Name of the journal table (default is `dbo.SchemaVersions`) |
| `WithTransactionPerScript()` | Each script is all-or-nothing |
| `WithExecutionTimeout` | Default is 30 s — too short for an index on a big table |

---

## Writing good migration scripts

### A normal migration

```sql
-- 0003_AddOrders_RowVersion.sql
ALTER TABLE dbo.Orders ADD RowVersion ROWVERSION NOT NULL;
GO

CREATE NONCLUSTERED INDEX IX_Orders_CustomerId
ON dbo.Orders (CustomerId)
INCLUDE (OrderDate, Status, Total);
GO
```

`GO` works in DbUp scripts for SQL Server: it splits the script into batches, just like in SSMS.

### Never edit a script that already ran

This is **the** most important rule. DbUp journals the script **name**, not its content. If you change `0002_AddOrders.sql` after it ran in production:

```sql
Production : already ran the old version → DbUp skips it → your change never arrives
New dev DB : runs the new version          → the two databases are now different
```

A mistake in a script that already ran? Write a **new** script that fixes it. Migrations only move forward.

### Reference data scripts must be idempotent

These scripts run on every deployment, so running them twice must not create duplicates. `MERGE` (or `IF NOT EXISTS`) is your friend:

```sql
-- ReferenceData/0001_Statuses.sql
MERGE dbo.OrderStatuses AS target
USING (VALUES
    (1, 'New'),
    (2, 'Paid'),
    (3, 'Shipped')
) AS source (Id, Name)
ON target.Id = source.Id
WHEN MATCHED AND target.Name <> source.Name THEN
    UPDATE SET Name = source.Name
WHEN NOT MATCHED THEN
    INSERT (Id, Name) VALUES (source.Id, source.Name);
```

Change a name in the script, deploy, and every environment gets it — because `RunAlways` scripts are never journaled.

### Watch out for `$` and transactions

- DbUp replaces **variables** written `$name$` (from `.WithVariable("name", "value")`). If your script contains a `$` for another reason (a password, a JSON path), disable it with `.WithVariablesDisabled()`.
- A few statements can't run inside a transaction (for example `ALTER DATABASE ... SET READ_COMMITTED_SNAPSHOT ON` needs care, and `CREATE DATABASE` can't). For those, use a separate upgrader with `.WithoutTransaction()`.

---

## Where to run it: a migrator app, not at API startup

You *can* call `DatabaseUpgrader.Run()` in the API's `Program.cs`. It's convenient on a dev machine, but in production:

```sql
❌ 3 API instances start at the same time → 3 runners race on the same scripts
❌ The API login needs ALTER/CREATE rights → much more than it should have
❌ A long migration blocks the API startup → health checks fail, restart loop
```

A small **console app** is better:

```csharp
// MyApp.DatabaseUpdater/Program.cs
var configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .AddCommandLine(args)
    .Build();

var connectionString = configuration.GetConnectionString("OrdersDb")
    ?? throw new InvalidOperationException("Connection string 'OrdersDb' is missing.");

var result = DatabaseUpgrader.Run(connectionString);

if (!result.Successful)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine($"Migration failed in {result.ErrorScript?.Name}: {result.Error}");
    Console.ResetColor();
    return -1;                     // non-zero exit code → the pipeline stops
}

Console.WriteLine("Database is up to date.");
return 0;
```

It uses the same configuration rules as the [configuration post](/blog/2025/07/09/aspnet-core-configuration-done-right): connection string from env vars on the server, no secret in the file. It runs with a login that has DDL rights, while the API keeps a minimal one.

### With .NET Aspire

Add the migrator as a project resource, and make the API wait until it finishes:

```csharp
var db = builder.AddSqlServer("sql").AddDatabase("ordersdb");

var migrator = builder.AddProject<Projects.MyApp_DatabaseUpdater>("db-migrator")
    .WithReference(db)
    .WaitFor(db);

builder.AddProject<Projects.MyApp_Api>("api")
    .WithReference(db)
    .WaitForCompletion(migrator);     // the API starts only after a successful migration
```

---

## Useful extras

### Dry run: what would run?

```csharp
var upgrader = /* same builder as above */ .Build();

if (upgrader.IsUpgradeRequired())
{
    foreach (var script in upgrader.GetScriptsToExecute())
        Console.WriteLine($"Will run: {script.Name}");
}
```

Perfect for a `--whatif` option before a production deployment.

### Adopting DbUp on an existing database

The database already exists and was built "by hand"? Generate a `0001_Init.sql` from it (SSMS → Generate Scripts), then on the existing servers **mark** it as already executed without running it:

```csharp
upgrader.MarkAsExecuted();   // journals all current scripts without running them
```

From now on, only new scripts run there, and a new empty database gets the full history.

### Test the migrations

A test that builds a fresh database from zero catches broken scripts before the deployment does:

```csharp
public class MigrationTests
{
    [Fact]
    public void All_scripts_run_on_an_empty_database()
    {
        var connectionString = $"Server=localhost;Database=MigrationTest_{Guid.NewGuid():N};Trusted_Connection=True;TrustServerCertificate=True";

        var result = DatabaseUpgrader.Run(connectionString);

        Assert.True(result.Successful, result.Error?.Message);
    }
}
```

(With Testcontainers you can start a throw-away SQL Server in Docker for this test, so it works the same in CI.)

---

## Zero downtime: expand, then contract

During a deployment, the **old** version of the app runs against the **new** schema for a while. So a migration must never break the version that's still running. Renaming a column in one script does exactly that:

```sql
-- ❌ The running app still SELECTs CustomerName → errors until the new version is live
EXEC sp_rename 'dbo.Customers.CustomerName', 'FullName', 'COLUMN';
```

Split it into steps, across deployments:

```sql
Deploy 1 (expand)   : 0010_Add_FullName.sql      → ADD FullName, copy data, app writes BOTH columns
Deploy 2 (migrate)  : app reads FullName only
Deploy 3 (contract) : 0011_Drop_CustomerName.sql → DROP CustomerName
```

The same idea works for a new `NOT NULL` column on a big table: add it as `NULL` (or with a `DEFAULT`), fill it in batches, then add the constraint in a later script.

---

## DbUp or EF Core migrations?

| | DbUp | EF Core migrations |
|---|---|---|
| You write | Plain SQL | C# model, migrations are generated |
| Fits | Dapper / SQL-first projects | EF Core code-first projects |
| Control over the SQL | Total (hints, `GO`, anything) | Generated, editable |
| Down / rollback scripts | ❌ Forward only | ✅ `Down()` method |
| Reference data | `RunAlways` idempotent scripts | `HasData` or custom code |
| Learning curve | Very small | Bigger |

Both can live in the same solution: EF Core migrations for the ASP.NET Identity tables, DbUp for the business database you query with Dapper.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Scripts in Git, embedded in the assembly | One versioned source of truth, one file to deploy |
| Zero-pad or timestamp the script names | DbUp sorts names as text |
| Never edit a script that already ran | The journal stores names, not content |
| Reference data: `RunAlways` + idempotent `MERGE` | Safe to run on every deployment |
| Schema group before reference data (`RunGroupOrder`) | Tables exist before data is inserted |
| One transaction per script, raise the timeout | All-or-nothing, and big indexes need time |
| Run migrations in a separate migrator app | No race between instances, minimal API rights |
| Return a non-zero exit code on failure | The pipeline stops before deploying the app |
| Expand → migrate → contract | The old app version keeps working during deployment |
| Test migrations on an empty database in CI | Broken scripts never reach production |

>
> ## That's it & see you soon!.
>
