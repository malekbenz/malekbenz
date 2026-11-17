---
layout: post
title: "ASP.NET Core - Load appsettings.json from the server, the simple way"
date: 2026-02-11
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: 'ASP.NET Core - Load appsettings.json from the server, the simple way'
image: /images/covers/aspnet-core-load-appsettings-from-server.png
---

You have 15 worker services installed on 15 machines. Every machine has its own `appsettings.json`, and they're all *almost* the same — except the three where somebody fixed a value by hand last year. In a [previous post](/blog/2025/08/13/aspnet-core-load-configuration-from-server) we built a full configuration server with a SQL table, a custom provider and SignalR push. That's powerful, but often you don't need all of it. Today: the **simple way**, which I've used in a real project — keep normal `appsettings`-style JSON files on one server, and let every app download its file at startup.

## The core idea: the same JSON, just somewhere else

ASP.NET Core doesn't care **where** a JSON configuration comes from. `AddJsonFile` reads it from disk, `AddJsonStream` reads it from any stream — including an HTTP response.

```sql
Machine PC-07 starts
  1. Read the small local appsettings.json   → "where is the config server? which profile am I?"
  2. GET https://config.example.com/api/settings/profiles/warehouse   → warehouse.json
  3. GET https://config.example.com/api/settings/machines/PC-07       → PC-07.json (optional)
  4. Merge everything, last one wins
  5. Continue the normal startup: Options, validation, DI...
```

> **The files on the server have exactly the format of appsettings.json. Admins already know it — there's nothing new to learn and nothing new to build.**

---

## The server side: a folder of JSON files

### One file per profile, one per machine

```sql
ConfigServer/
└── settings/
    ├── profiles/
    │   ├── warehouse.json    ← every machine with the "warehouse" profile
    │   └── office.json       ← every machine with the "office" profile
    └── machines/
        └── PC-07.json        ← overrides for one machine only
```

```json
{
  "Import": { "IntervalSeconds": 30, "BatchSize": 500 },
  "Mail":   { "SmtpHost": "smtp.example.com", "Port": 587 },
  "Logging": { "LogLevel": { "Default": "Information" } }
}
```

That's `profiles/warehouse.json`. And `machines/PC-07.json` only contains what's different for that machine:

```json
{
  "Import": { "BatchSize": 100 }
}
```

PC-07 gets `IntervalSeconds = 30` from its profile and `BatchSize = 100` from its own file. Keys merge, they don't replace the whole section.

### The endpoint: just return the file

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

var safeName = new Regex("^[a-zA-Z0-9-]{1,50}$", RegexOptions.Compiled);
var settingsRoot = Path.Combine(app.Environment.ContentRootPath, "settings");

IResult SendSettings(string folder, string name)
{
    // Never let the client build a path like "../../appsettings.Production.json"
    if (!safeName.IsMatch(name))
        return Results.BadRequest();

    var path = Path.Combine(settingsRoot, folder, $"{name}.json");

    return File.Exists(path)
        ? Results.File(path, "application/json")
        : Results.NotFound();
}

app.MapGet("/api/settings/profiles/{profile}", (string profile) => SendSettings("profiles", profile))
   .RequireAuthorization();

app.MapGet("/api/settings/machines/{machineId}", (string machineId) => SendSettings("machines", machineId))
   .RequireAuthorization();

app.Run();
```

Two security points that are easy to forget:

- **The regex on the name.** Without it, `GET /api/settings/profiles/..%2F..%2Fappsettings.Production` could read files you never wanted to serve.
- **`RequireAuthorization()`.** The settings describe your whole system: hosts, ports, folders. They're not public.

Changing a setting for every warehouse machine = editing **one** file. And if you put the `settings/` folder in Git, you get history and review for free.

---

## The client side: download and AddJsonStream

The local `appsettings.json` on each machine becomes tiny — only the bootstrap values:

```json
{
  "ConfigServer": {
    "Url": "https://config.example.com",
    "Profile": "warehouse",
    "MachineId": "PC-07"
  }
}
```

(The token to call the server comes from an environment variable, `ConfigServer__Token` — not from this file.)

```csharp
public static class ServerSettingsExtensions
{
    public static async Task AddServerSettingsAsync(this IHostApplicationBuilder builder)
    {
        var section = builder.Configuration.GetSection("ConfigServer");
        var url = section["Url"] ?? throw new InvalidOperationException("ConfigServer:Url is missing.");
        var profile = section["Profile"] ?? throw new InvalidOperationException("ConfigServer:Profile is missing.");
        var machineId = section["MachineId"] ?? Environment.MachineName;

        using var http = new HttpClient { BaseAddress = new Uri(url), Timeout = TimeSpan.FromSeconds(10) };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", section["Token"]);

        // 1. The profile (required)
        var profileJson = await http.GetByteArrayAsync($"api/settings/profiles/{profile}");
        builder.Configuration.AddJsonStream(new MemoryStream(profileJson));

        // 2. The machine overrides (optional) — added after, so they win
        using var response = await http.GetAsync($"api/settings/machines/{machineId}");
        if (response.IsSuccessStatusCode)
            builder.Configuration.AddJsonStream(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
    }
}
```

```csharp
var builder = Host.CreateApplicationBuilder(args);   // local appsettings.json + env vars are loaded here

await builder.AddServerSettingsAsync();              // server files: override the local values
builder.Configuration.AddEnvironmentVariables();     // a local emergency override still wins

builder.Services.AddOptions<ImportOptions>()
    .BindConfiguration(ImportOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddHostedService<ImportWorker>();

builder.Build().Run();
```

The layers, from weakest to strongest:

```sql
local appsettings.json  →  profiles/warehouse.json  →  machines/PC-07.json  →  environment variables
```

And because the server files are **just configuration**, everything from the [configuration post](/blog/2025/07/09/aspnet-core-configuration-done-right) still applies: `IOptions<T>`, `ValidateOnStart()`, `GetConnectionString()`...

### Two things to know about AddJsonStream

| Detail | Consequence |
|---|---|
| The stream is read **once** | No `reloadOnChange`: a change on the server is seen only after a restart |
| The stream must stay readable until the configuration is built | Use `new MemoryStream(bytes)` — don't pass the HTTP response stream, it's not seekable and it's closed with the response |

---

## Server down at startup: retry, but not forever

The first idea is a loop: "can't reach the server, retry in 5 seconds", until it works. For a console app or a container, waiting is fine. For a **Windows service**, it's a trap:

```sql
Windows starts the service
  → the Service Control Manager waits ~30 seconds for "service started"
  → our code is still blocked in the retry loop, before host.Run()
  → ❌ "The service did not respond to the start or control request in a timely fashion."
```

The service is killed, and on a machine that boots while the network isn't ready yet, it happens **every morning**. So: a few retries, then fall back to the last copy we downloaded.

---

## The trick: save a local copy and use AddJsonFile

Instead of `AddJsonStream`, write the downloaded JSON to a **local file**, then load that file with `AddJsonFile(..., reloadOnChange: true)`. One small change, two big features.

```csharp
public static async Task AddServerSettingsAsync(this IHostApplicationBuilder builder)
{
    var section = builder.Configuration.GetSection("ConfigServer");
    var profile = section["Profile"] ?? throw new InvalidOperationException("ConfigServer:Profile is missing.");
    var localCopy = Path.Combine(builder.Environment.ContentRootPath, "server-settings.json");

    using var http = CreateClient(section);

    for (var attempt = 1; attempt <= 3; attempt++)
    {
        try
        {
            await DownloadAsync(http, $"api/settings/profiles/{profile}", localCopy);
            break;
        }
        catch (Exception ex) when (attempt < 3)
        {
            Console.WriteLine($"[config] attempt {attempt} failed: {ex.Message} — retrying in 5s");
            await Task.Delay(TimeSpan.FromSeconds(5));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[config] server unreachable ({ex.Message}) — using the last downloaded copy");
        }
    }

    // Server or not, the app always reads the same local file
    builder.Configuration.AddJsonFile(localCopy, optional: false, reloadOnChange: true);
}

public static async Task DownloadAsync(HttpClient http, string url, string localCopy, CancellationToken ct = default)
{
    var json = await http.GetStringAsync(url, ct);

    JsonDocument.Parse(json).Dispose();                         // never save an invalid file

    await File.WriteAllTextAsync(localCopy + ".tmp", json, ct);
    File.Move(localCopy + ".tmp", localCopy, overwrite: true);  // atomic: never a half-written file
}

public static HttpClient CreateClient(IConfigurationSection section)
{
    var url = section["Url"] ?? throw new InvalidOperationException("ConfigServer:Url is missing.");

    var http = new HttpClient { BaseAddress = new Uri(url), Timeout = TimeSpan.FromSeconds(5) };
    http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", section["Token"]);
    return http;
}
```

(All three methods live in the same `ServerSettingsExtensions` static class.)

**Feature 1 — offline fallback.**

```sql
Server OK          → download, save the local copy, start      ✅
Server down        → start with the last local copy             ✅
Never downloaded   → optional: false → clear error at startup   ❌ on purpose (first install needs the server)
```

**Feature 2 — live reload, for free.** The JSON file provider watches the file. If something overwrites it, the configuration reloads and `IOptionsMonitor<T>` gets the new values. So a small background service that downloads the file again from time to time is all we need:

```csharp
public sealed class SettingsRefreshService(
    IConfiguration configuration,
    IHostEnvironment env,
    ILogger<SettingsRefreshService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var section = configuration.GetSection("ConfigServer");
        var url = $"api/settings/profiles/{section["Profile"]}";
        var localCopy = Path.Combine(env.ContentRootPath, "server-settings.json");

        using var http = ServerSettingsExtensions.CreateClient(section);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await ServerSettingsExtensions.DownloadAsync(http, url, localCopy, stoppingToken);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Settings refresh failed, keeping the current values");
            }
        }
    }
}
```

```csharp
builder.Services.AddHostedService<SettingsRefreshService>();
```

The worker that injects `IOptionsMonitor<ImportOptions>` sees the new `IntervalSeconds` at most 5 minutes after you edit `warehouse.json` on the server — **no restart, no custom provider**.

> Overwriting the file with the same content still triggers a reload. It's harmless, but if you want to avoid it, compare the downloaded JSON with the current file before moving it.

---

## What must NOT go in these files

The files are downloaded to every machine and saved there **in clear text**. So:

| Value | Server JSON file? |
|---|---|
| URLs, ports, folders, intervals, batch sizes, log levels, feature flags | ✅ Yes |
| Connection strings with integrated security (no password) | ✅ Yes |
| Passwords, API keys, signing keys | ❌ Machine environment variables or a vault |
| The token used to call the config server | ❌ Environment variable on each machine |

---

## File or provider?

| Need | `settings.json` on the server (this post) | Custom provider ([previous post](/blog/2025/08/13/aspnet-core-load-configuration-from-server)) |
|---|---|---|
| Effort | ⭐ A few lines | ⭐⭐⭐ ~200 lines |
| Edit settings | Edit a JSON file | Rows in a table (or a UI on top) |
| Per-machine overrides | A second file, added after | More specific rows |
| Live changes | Local copy + refresh service (minutes) | `OnReload()` + SignalR push (seconds) |
| History / audit | Git on the `settings/` folder | `UpdatedAt` + a history table |

Start with the files. Move to the provider when you need a UI, an audit trail, or changes applied in seconds.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Server files use the exact appsettings.json format | Nothing new to learn for admins |
| Keep only bootstrap values in the local file | URL, profile, machine id — the rest comes from the server |
| Profile first, machine overrides after, env vars last | The most specific value wins |
| Validate the file name on the server, require auth | No path traversal, no public config |
| `AddJsonStream` + `MemoryStream`, read once | Simple, but no reload |
| Bounded retries, never an endless loop in a Windows service | The SCM kills a service that blocks ~30 s |
| Save a local copy, load it with `AddJsonFile(reloadOnChange: true)` | Offline fallback and live reload for free |
| Validate the JSON and write atomically (`.tmp` + `File.Move`) | Never start with a broken or half-written file |
| No secrets in the server files | They're copied in clear text to every machine |

>
> ## That's it & see you soon!.
>
