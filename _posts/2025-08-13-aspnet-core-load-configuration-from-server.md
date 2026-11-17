---
layout: post
title: "ASP.NET Core - Load configuration from a server, not only appsettings.json"
date: 2025-08-13
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#', 'SignalR', 'Dapper']
categories: ['Asp.Net', '.Net']
description: 'ASP.NET Core - Load configuration from a server, not only appsettings.json'
image: /images/covers/aspnet-core-load-configuration-from-server.png
---

You have 20 workers installed as Windows services on 20 machines, plus a few APIs. One day the mail server URL changes, or you want to change a sync interval. With only `appsettings.json`, that means 20 remote sessions, 20 files edited by hand, and at least one typo. Let's build a better way: keep the settings **on a server**, and let every app load them at startup — and pick up changes while running.

In the [previous post](/blog/2025/07/09/aspnet-core-configuration-done-right) we saw that ASP.NET Core configuration is a stack of providers. Today we write our own.

## The core idea: configuration is just a provider

`appsettings.json`, environment variables, User Secrets... they're all **configuration providers**. Each one fills a dictionary of `key → value`, and the configuration system merges them.

```sql
appsettings.json        →  "Import:IntervalSeconds" = "60"
Environment variables   →  "ConnectionStrings:Local" = "..."
Remote provider (ours)  →  "Import:IntervalSeconds" = "30"   ← last one wins
```

So if we write a provider that loads its dictionary **from an HTTP API**, all the rest keeps working: `IOptions<T>`, `IOptionsMonitor<T>`, `ValidateOnStart()`, `GetConnectionString()`. Our application code doesn't even know where the values come from.

> **The goal: change a value in one place, and every app sees it — without redeploying or editing files on machines.**

---

## The architecture

```sql
                ┌──────────────────────────────┐
                │        Config Server          │
                │  SQL table  +  minimal API    │
                │  + SignalR hub (notify)       │
                └───────▲───────────┬──────────┘
          GET /api/config│           │ "ConfigChanged"
                         │           ▼
     ┌───────────────────┴──┐   ┌──────────────────────┐
     │ Worker (Windows svc)  │   │ Orders API            │
     │ RemoteConfigProvider  │   │ RemoteConfigProvider  │
     │ + local cache file    │   │ + local cache file    │
     └───────────────────────┘   └──────────────────────┘
```

Each app keeps a tiny local `appsettings.json` with only the **bootstrap** settings: the config server URL, its own name, and a token. Everything else comes from the server.

---

## The server side

### Settings table in SQL Server

```sql
CREATE TABLE AppSettings
(
    Id          INT IDENTITY PRIMARY KEY,
    AppName     VARCHAR(100)   NOT NULL,   -- 'report-worker', 'orders-api' or '*' for all apps
    Environment VARCHAR(50)    NOT NULL,   -- 'Production', 'Staging' or '*' for all
    [Key]       VARCHAR(200)   NOT NULL,   -- 'Import:IntervalSeconds'
    [Value]     NVARCHAR(MAX)  NULL,
    UpdatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AppSettings UNIQUE (AppName, Environment, [Key])
);

INSERT INTO AppSettings (AppName, Environment, [Key], [Value]) VALUES
('*',          '*',          'Logging:LogLevel:Default', 'Information'),
('*',          'Production', 'Mail:SmtpHost',             'smtp.example.com'      ),
('report-worker', '*',       'Import:IntervalSeconds',     '60'),
('report-worker', 'Production', 'Import:IntervalSeconds',     '30');
```

The `'*'` rows are shared defaults. A more specific row (same key) wins:

```sql
'*' + '*'  →  app + '*'  →  '*' + env  →  app + env      (most specific wins)
```

### The minimal API

```csharp
app.MapGet("/api/config/{appName}", async (
        string appName, string environment,
        HttpContext http, IDbConnectionFactory db) =>
{
    using var connection = db.Create();

    var rows = await connection.QueryAsync<(string Key, string? Value)>(@"
        SELECT [Key], [Value]
        FROM AppSettings
        WHERE AppName IN ('*', @AppName) AND Environment IN ('*', @Environment)
        ORDER BY CASE WHEN AppName = '*' THEN 0 ELSE 1 END
               + CASE WHEN Environment = '*' THEN 0 ELSE 2 END;",
        new
        {
            AppName = new DbString { Value = appName, IsAnsi = true, Length = 100 },
            Environment = new DbString { Value = environment, IsAnsi = true, Length = 50 }
        });

    // Rows come from least to most specific: the last value for a key wins
    var settings = new SortedDictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
    foreach (var (key, value) in rows)
        settings[key] = value;

    // ETag = hash of the content: changes on insert, update AND delete
    var json = JsonSerializer.Serialize(settings);
    var etag = $"\"{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))[..16]}\"";

    if (http.Request.Headers.IfNoneMatch == etag)
        return Results.StatusCode(StatusCodes.Status304NotModified);

    http.Response.Headers.ETag = etag;
    return Results.Text(json, "application/json");
})
.RequireAuthorization("ConfigReader");
```

Two details:

- **ETag + `If-None-Match`**: when nothing changed, the server answers `304 Not Modified` with an empty body. Polling every 30 seconds from 20 machines costs almost nothing.
- **`RequireAuthorization`**: the configuration describes your whole system (URLs, ports, flags). It must not be public. Each app sends a token from its bootstrap config.

---

## The client side: a custom IConfigurationProvider

### The bootstrap appsettings.json

```json
{
  "RemoteConfig": {
    "ServerUrl": "https://config.example.com",
    "AppName": "report-worker",
    "ReloadSeconds": 300
  }
}
```

The token itself comes from an environment variable or User Secrets (`RemoteConfig__Token`) — not from the file.

### ConfigurationSource + ConfigurationProvider

A provider is two classes. The **source** holds the settings and creates the **provider**:

```csharp
public sealed class RemoteConfigurationSource : IConfigurationSource
{
    public required Uri ServerUrl { get; init; }
    public required string AppName { get; init; }
    public required string Environment { get; init; }
    public required string Token { get; init; }
    public required string CacheFile { get; init; }
    public TimeSpan ReloadInterval { get; init; } = TimeSpan.FromMinutes(5);

    public IConfigurationProvider Build(IConfigurationBuilder builder) => new RemoteConfigurationProvider(this);
}
```

The provider fills the `Data` dictionary that it inherits from `ConfigurationProvider`:

```csharp
public sealed class RemoteConfigurationProvider : ConfigurationProvider, IDisposable
{
    private readonly RemoteConfigurationSource _source;
    private readonly HttpClient _http;
    private readonly CancellationTokenSource _stop = new();
    private string? _etag;
    private bool _pollingStarted;

    public RemoteConfigurationProvider(RemoteConfigurationSource source)
    {
        _source = source;
        _http = new HttpClient { BaseAddress = source.ServerUrl, Timeout = TimeSpan.FromSeconds(5) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", source.Token);
    }

    // Called once, when the configuration is built
    public override void Load()
    {
        try
        {
            if (!FetchAsync(_stop.Token).GetAwaiter().GetResult())
                LoadFromCache();
        }
        catch (Exception)
        {
            LoadFromCache();      // server down → last known good values
        }

        if (!_pollingStarted)
        {
            _pollingStarted = true;
            _ = PollAsync(_stop.Token);
            _ = ConnectHubAsync(_stop.Token);    // optional push, see the SignalR part below
        }
    }

    // Returns true when new data was loaded
    private async Task<bool> FetchAsync(CancellationToken ct)
    {
        var url = $"api/config/{_source.AppName}?environment={_source.Environment}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (_etag is not null)
            request.Headers.IfNoneMatch.Add(EntityTagHeaderValue.Parse(_etag));

        using var response = await _http.SendAsync(request, ct);

        if (response.StatusCode == HttpStatusCode.NotModified)
            return false;

        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        var data = JsonSerializer.Deserialize<Dictionary<string, string?>>(json)!;

        Data = new Dictionary<string, string?>(data, StringComparer.OrdinalIgnoreCase);
        _etag = response.Headers.ETag?.ToString();

        SaveToCache(json);
        return true;
    }

    public void Dispose() { _stop.Cancel(); _http.Dispose(); }
}
```

Note that we **replace** the whole `Data` dictionary instead of changing it key by key. Other threads may be reading the configuration at the same time — swapping the reference is safe, editing the dictionary is not.

### Loading at startup (before DI exists!)

There's a trap here: configuration is built **before** the dependency injection container. No `IHttpClientFactory`, no `ILogger`, no `IOptions` yet. That's why the provider creates its own `HttpClient` and reads its bootstrap values directly from the configuration loaded so far:

```csharp
public static class RemoteConfigurationExtensions
{
    public static IConfigurationBuilder AddRemoteConfiguration(
        this IConfigurationManager configuration, IHostEnvironment env)
    {
        var section = configuration.GetSection("RemoteConfig");

        return configuration.Add(new RemoteConfigurationSource
        {
            ServerUrl = new Uri(section["ServerUrl"] ?? throw new InvalidOperationException("RemoteConfig:ServerUrl is missing.")),
            AppName = section["AppName"] ?? env.ApplicationName,
            Environment = env.EnvironmentName,
            Token = section["Token"] ?? throw new InvalidOperationException("RemoteConfig:Token is missing."),
            CacheFile = Path.Combine(env.ContentRootPath, "remote-config.cache.json"),
            ReloadInterval = TimeSpan.FromSeconds(section.GetValue("ReloadSeconds", 300))
        });
    }
}
```

```csharp
var builder = Host.CreateApplicationBuilder(args);

builder.Configuration.AddRemoteConfiguration(builder.Environment);

// Add env vars again so a local override still wins over the server (emergency fix)
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddOptions<ImportOptions>()
    .BindConfiguration(ImportOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

`ValidateOnStart()` still protects us: if the server sends a bad value (or nothing at all, and there's no cache), the app refuses to start with a clear error.

### Polling for changes + OnReload()

```csharp
private async Task PollAsync(CancellationToken ct)
{
    using var timer = new PeriodicTimer(_source.ReloadInterval);

    while (await timer.WaitForNextTickAsync(ct))
        await ReloadNowAsync(ct);
}

public async Task ReloadNowAsync(CancellationToken ct = default)
{
    try
    {
        if (await FetchAsync(ct))
            OnReload();          // fires the change token
    }
    catch (Exception) when (!ct.IsCancellationRequested)
    {
        // Server unreachable: keep the current values, try again next tick
    }
}
```

`OnReload()` is the magic call. It fires the configuration **change token**, and everything that listens to it updates:

| You inject | After `OnReload()` |
|---|---|
| `IOptions<T>` | ❌ Keeps the old value (read once) |
| `IOptionsSnapshot<T>` | ✅ New value on the next request |
| `IOptionsMonitor<T>` | ✅ New value now, `OnChange` callback fires |

So the worker from the previous post, using `IOptionsMonitor<ImportOptions>`, switches from 60 to 30 seconds **without restarting**.

---

## Server down? Local cache file as fallback

The config server becomes a critical dependency: if it's down and a worker restarts, the worker must still start. The fix is a **last known good** copy on disk:

```csharp
private void SaveToCache(string json)
{
    var temp = _source.CacheFile + ".tmp";
    File.WriteAllText(temp, json);
    File.Move(temp, _source.CacheFile, overwrite: true);   // atomic replace: never a half-written file
}

private void LoadFromCache()
{
    if (!File.Exists(_source.CacheFile))
        return;                                              // no cache → ValidateOnStart will tell us

    var data = JsonSerializer.Deserialize<Dictionary<string, string?>>(File.ReadAllText(_source.CacheFile))!;
    Data = new Dictionary<string, string?>(data, StringComparer.OrdinalIgnoreCase);
}
```

```sql
Startup, server OK      → load from server, write cache       ✅
Startup, server down    → load from cache, keep polling        ✅ starts with last known values
Startup, no server, no cache (first install) → ValidateOnStart fails  ❌ clear error, on purpose
```

For a Windows service, remember the content root rule from the previous post — the cache path is built from `ContentRootPath`, never from the current directory (which is `System32`).

---

## Push instead of poll: notify with SignalR

Polling every 5 minutes is fine for most settings. When you want changes **in seconds**, let the server tell the clients. Polling stays as a safety net.

### Server: a hub and a notification on save

```csharp
public sealed class ConfigHub : Hub
{
    public Task Subscribe(string appName, string environment) =>
        Groups.AddToGroupAsync(Context.ConnectionId, $"{appName}:{environment}");
}

app.MapHub<ConfigHub>("/hubs/config").RequireAuthorization("ConfigReader");

app.MapPut("/api/config/{appName}/{environment}/{key}", async (
        string appName, string environment, string key, [FromBody] string? value,
        IDbConnectionFactory db, IHubContext<ConfigHub> hub) =>
{
    using var connection = db.Create();
    await connection.ExecuteAsync(@"
        MERGE AppSettings AS t
        USING (SELECT @AppName AS AppName, @Environment AS Environment, @Key AS [Key]) AS s
        ON t.AppName = s.AppName AND t.Environment = s.Environment AND t.[Key] = s.[Key]
        WHEN MATCHED THEN UPDATE SET [Value] = @Value, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (AppName, Environment, [Key], [Value])
                              VALUES (@AppName, @Environment, @Key, @Value);",
        new { AppName = appName, Environment = environment, Key = key, Value = value });

    // '*' rows concern everybody: notify all, otherwise only the matching group
    if (appName == "*" || environment == "*")
        await hub.Clients.All.SendAsync("ConfigChanged");
    else
        await hub.Clients.Group($"{appName}:{environment}").SendAsync("ConfigChanged");

    return Results.NoContent();
})
.RequireAuthorization("ConfigAdmin");
```

### Client: listen and reload

Inside the provider, after the first load:

```csharp
private async Task ConnectHubAsync(CancellationToken ct)
{
    var hub = new HubConnectionBuilder()
        .WithUrl(new Uri(_source.ServerUrl, "hubs/config"),
                 o => o.AccessTokenProvider = () => Task.FromResult<string?>(_source.Token))
        .WithAutomaticReconnect()
        .Build();

    hub.On("ConfigChanged", () => ReloadNowAsync(ct));

    // After a reconnect: join the group again and reload (we may have missed a message)
    hub.Reconnected += async _ =>
    {
        await hub.InvokeAsync("Subscribe", _source.AppName, _source.Environment, ct);
        await ReloadNowAsync(ct);
    };

    await hub.StartAsync(ct);
    await hub.InvokeAsync("Subscribe", _source.AppName, _source.Environment, ct);
}
```

Thanks to the ETag, a `ConfigChanged` message that doesn't concern this app costs one `304` — nothing more.

---

## Secrets: what must NOT go through it

It's tempting to put everything in the config table, connection string passwords included. Don't:

| Kind of value | Where |
|---|---|
| URLs, intervals, feature flags, log levels, limits | ✅ Config server |
| Connection strings **without** password (integrated security / managed identity) | ✅ Config server |
| Passwords, API keys, signing keys | ❌ A vault (Key Vault...) or machine env vars |
| The config server token itself | ❌ Env var / User Secrets on each machine |

Why: the config table is readable by every admin of the config server, the values travel to every machine, and they're written to the **cache file in clear text**. If a secret must be cached, protect the file (on Windows, `ProtectedData` with `DataProtectionScope.LocalMachine`) — but a vault is better.

And never log the configuration values when you debug the provider — log the **keys** only.

---

## Alternatives: build or buy?

Writing your own provider is ~200 lines and gives you total control (and it works on-premises, with no cloud). But there are ready-made options:

| Option | Strengths | Think about it when |
|---|---|---|
| Own config server (this post) | Simple, on-premises, uses your SQL Server + SignalR | Internal apps, Windows services, no cloud |
| Azure App Configuration | Managed, labels per environment, feature flags, refresh with a sentinel key, Key Vault references | You're already on Azure |
| Consul KV | Watches (push), service discovery, community .NET provider | Microservices outside Azure |
| AWS AppConfig / Parameter Store | Managed on AWS, gradual deployments | You're on AWS |

The nice part: because all of them are **configuration providers**, you can start with your own server and switch later — your `IOptions<T>` code doesn't change.

---

## Key rules to remember

| Rule | Why |
|---|---|
| A remote config is just another `IConfigurationProvider` | Options, validation and DI keep working |
| Keep a small local bootstrap config (URL, app name, token) | The app must know where to ask |
| Configuration is built before DI | The provider creates its own `HttpClient` |
| Replace `Data` as a whole, then call `OnReload()` | Thread-safe, and `IOptionsMonitor` sees the change |
| Use ETag + `304 Not Modified` | Polling costs almost nothing |
| Always keep a last-known-good cache file (atomic write) | Server down ≠ app down |
| Push with SignalR, but keep polling as a safety net | Fast updates, no missed changes after a reconnect |
| Re-add env vars after the remote provider | A local emergency override still wins |
| Keep `ValidateOnStart()` | A bad value from the server stops the app clearly |
| No secrets in the config table or cache file | It travels everywhere and is stored in clear text |

>
> ## That's it & see you soon!.
>
