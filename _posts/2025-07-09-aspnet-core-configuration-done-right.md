---
layout: post
title: "ASP.NET Core Configuration done right - Options pattern, secrets and environments"
date: 2025-07-09
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#', 'React']
categories: ['Asp.Net', '.Net']
description: 'ASP.NET Core Configuration done right - Options pattern, secrets and environments'
image: /images/covers/aspnet-core-configuration-done-right.png
---

A JWT key committed to Git. A typo in a section name that silently gives you `null` — or worse, default values — in production. A Windows service that can't find its `appsettings.json`. A React build that points to the test API. Configuration looks like the easy part of an app, until it breaks at 2 AM. Let's see how ASP.NET Core configuration really works, and the few rules that make it boring (in the good way).

## The core idea: layered configuration providers

In ASP.NET Core, configuration is not one file. It's a **stack of providers**, all merged into one big dictionary of `key → value`:

```sql
"Jwt:Issuer"                      → "https://auth.myapp.com"
"ConnectionStrings:OrdersDb"      → "Server=...;Database=Orders;..."
"Logging:LogLevel:Default"        → "Information"
```

Nested JSON sections become keys separated by `:`. When the same key exists in several providers, **the last provider wins**.

> **You don't read "the appsettings file". You read the result of all providers merged together.**

---

## The order that wins

`WebApplication.CreateBuilder(args)` (and `Host.CreateApplicationBuilder(args)` for workers) loads these providers, in this order:

| # | Provider | Typical use |
|---|---|---|
| 1 | `appsettings.json` | Defaults shared by all environments |
| 2 | `appsettings.{Environment}.json` | Overrides per environment (Development, Staging, Production) |
| 3 | User Secrets (Development only) | Secrets on the developer machine |
| 4 | Environment variables | Servers, containers, Aspire, CI/CD |
| 5 | Command-line arguments | One-off overrides |

So with this `appsettings.json`:

```json
{
  "ConnectionStrings": {
    "OrdersDb": "Server=localhost;Database=Orders;Trusted_Connection=True;TrustServerCertificate=True"
  }
}
```

An environment variable on the server replaces it without touching any file:

```sql
ConnectionStrings__OrdersDb=Server=prod-sql;Database=Orders;User Id=app;Password=...
```

In environment variables, `:` is written `__` (double underscore), because `:` is not allowed everywhere.

The environment name itself comes from `ASPNETCORE_ENVIRONMENT` (or `DOTNET_ENVIRONMENT` for workers). If nothing is set, it's **Production** — a safe default.

---

## The classic way — and why it's fragile

This is the code I see (and wrote!) in many projects:

```csharp
var mailOptions = builder.Configuration.GetSection("MailOptions").Get<MailOptions>()
                  ?? new MailOptions();
```

It looks fine, but three things can go wrong silently:

```sql
1. Typo in the section name ("MailOption")   → Get<T>() returns null → you get the defaults
2. Typo in a property name in the JSON      → property keeps its default value
3. Missing required value (empty Url)       → crash later, far from the cause
```

The app starts, everything looks OK, and the bug appears hours later on the first real request. We want the opposite: **if the configuration is wrong, the app must refuse to start.**

---

## Strongly typed settings: the Options pattern

### Step 1 — a class with its section name

```csharp
public sealed class JwtOptions
{
    public const string Section = "Jwt";

    [Required, Url]
    public string Issuer { get; init; } = "";

    [Required]
    public string Audience { get; init; } = "";

    [Required, MinLength(32)]
    public string Key { get; init; } = "";

    [Range(1, 1440)]
    public int ExpirationMinutes { get; init; } = 60;
}
```

Keeping the section name **in the class** (`JwtOptions.Section`) means no more magic strings spread around `Program.cs`.

### Step 2 — register, bind and validate

```csharp
builder.Services
    .AddOptions<JwtOptions>()
    .BindConfiguration(JwtOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

- `BindConfiguration` binds the `Jwt` section to the class.
- `ValidateDataAnnotations` checks the `[Required]`, `[Url]`, `[Range]`... attributes.
- `ValidateOnStart` runs the validation **when the app starts**, not on first use.

With a missing key, the app stops immediately with a clear message:

```sql
Microsoft.Extensions.Options.OptionsValidationException:
DataAnnotation validation failed for 'JwtOptions' members: 'Key' with the error:
'The Key field is required.'
```

That's exactly what you want to see during a deployment — not a `401` on every request three hours later.

### Step 3 — inject it

```csharp
public sealed class TokenService(IOptions<JwtOptions> options)
{
    private readonly JwtOptions _jwt = options.Value;

    public string CreateToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Key));
        // ...
    }
}
```

### Already using FluentValidation?

You can reuse it for options with a small adapter:

```csharp
public sealed class JwtOptionsValidator : AbstractValidator<JwtOptions>
{
    public JwtOptionsValidator()
    {
        RuleFor(x => x.Issuer).NotEmpty().Must(u => Uri.IsWellFormedUriString(u, UriKind.Absolute));
        RuleFor(x => x.Key).NotEmpty().MinimumLength(32);
    }
}

public sealed class FluentValidateOptions<T>(IValidator<T> validator) : IValidateOptions<T>
    where T : class
{
    public ValidateOptionsResult Validate(string? name, T options)
    {
        var result = validator.Validate(options);
        return result.IsValid
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(result.Errors.Select(e => e.ErrorMessage));
    }
}

// Registration
builder.Services.AddSingleton<IValidator<JwtOptions>, JwtOptionsValidator>();
builder.Services.AddSingleton<IValidateOptions<JwtOptions>, FluentValidateOptions<JwtOptions>>();
builder.Services.AddOptions<JwtOptions>().BindConfiguration(JwtOptions.Section).ValidateOnStart();
```

---

## IOptions vs IOptionsSnapshot vs IOptionsMonitor

`appsettings.json` is reloaded automatically when the file changes. Whether your code **sees** the new values depends on which interface you inject:

| Interface | Lifetime | Sees file changes? | Use it for |
|---|---|---|---|
| `IOptions<T>` | Singleton | ❌ Read once at first use | Most settings (keys, URLs, connection info) |
| `IOptionsSnapshot<T>` | Scoped | ✅ Once per request | Feature flags read in controllers / endpoints |
| `IOptionsMonitor<T>` | Singleton | ✅ Any time, with `OnChange` | Background services, long-running workers |

A background worker that should pick up a new polling interval without restarting:

```csharp
public sealed class ImportWorker(IOptionsMonitor<ImportOptions> options, ILogger<ImportWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        options.OnChange(o => logger.LogInformation("Import interval changed to {Seconds}s", o.IntervalSeconds));

        while (!stoppingToken.IsCancellationRequested)
        {
            await ImportOnceAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(options.CurrentValue.IntervalSeconds), stoppingToken);
        }
    }
}
```

> Don't inject `IOptionsSnapshot<T>` into a singleton — it's scoped, and the DI container will throw. Use `IOptionsMonitor<T>` there.

---

## Secrets: never in appsettings.json

If your `appsettings.json` contains this and is in Git, the key is public for everybody who ever had access to the repository — forever, even if you delete it later:

```json
"Jwt": { "Key": "my-super-secret-signing-key-123456" }
```

Leave the slot **empty** in the file (so the structure is documented), and fill it from a safe place.

### On the developer machine: User Secrets

```sql
dotnet user-secrets init
dotnet user-secrets set "Jwt:Key" "a-long-random-development-key-at-least-32-chars"
dotnet user-secrets set "ConnectionStrings:OrdersDb" "Server=localhost;Database=Orders;..."
```

The values are stored outside the project folder (in your user profile), so they can't be committed. They're loaded only when the environment is **Development**.

### On servers: environment variables or a vault

```sql
Jwt__Key=...
ConnectionStrings__OrdersDb=...
```

Or Azure Key Vault, loaded as one more configuration provider (package `Azure.Extensions.AspNetCore.Configuration.Secrets`):

```csharp
if (builder.Environment.IsProduction())
{
    builder.Configuration.AddAzureKeyVault(
        new Uri("https://myapp-kv.vault.azure.net/"),
        new DefaultAzureCredential());
}
```

In Key Vault, the secret name uses `--` for sections: `Jwt--Key`.

### With .NET Aspire

When the AppHost references a database, Aspire injects the connection string into the service as an environment variable (`ConnectionStrings__ordersdb`). Your code doesn't change — `GetConnectionString("ordersdb")` just works.

---

## Connection strings & a Dapper connection factory

Instead of calling `GetConnectionString` (with a string name) in every repository, read it once, validate it, and hide it behind a factory:

```csharp
public interface IDbConnectionFactory
{
    IDbConnection Create();
}

public sealed class SqlConnectionFactory : IDbConnectionFactory
{
    private readonly string _connectionString;

    public SqlConnectionFactory(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("OrdersDb")
            ?? throw new InvalidOperationException("Connection string 'OrdersDb' is missing.");
    }

    public IDbConnection Create() => new SqlConnection(_connectionString);
}

builder.Services.AddSingleton<IDbConnectionFactory, SqlConnectionFactory>();
```

Because it's a singleton created at startup, a missing connection string fails **immediately**. Repositories only depend on `IDbConnectionFactory` — easy to swap for SQLite in tests.

---

## Windows services: where is my appsettings.json?

A worker installed as a Windows service starts with the current directory set to `C:\Windows\System32`. If you build paths from the current directory, the service won't find its files.

```csharp
var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(o => o.ServiceName = "My Import Worker");
builder.Services.AddHostedService<ImportWorker>();

builder.Build().Run();
```

`AddWindowsService()` sets the **content root** to the application folder when it runs as a service, so `appsettings.json` is found. For your own files, build paths from `builder.Environment.ContentRootPath` or `AppContext.BaseDirectory` — never from `Directory.GetCurrentDirectory()`.

And remember: a service doesn't see your User Secrets. On the server, use environment variables (machine-level) or a vault.

---

## React side: config for the front-end

### Build-time config with Vite

```sql
# .env.development
VITE_API_URL=https://localhost:7001

# .env.production
VITE_API_URL=https://api.myapp.com
```

```js
const baseUrl = import.meta.env.VITE_API_URL;
```

Only variables starting with `VITE_` are exposed, and they're **written into the JavaScript bundle**. Anybody can read them in the browser's dev tools.

> **There is no secret in a front-end.** API keys, connection strings, JWT signing keys: never in a `VITE_` variable.

### Runtime config: one build for all environments

The problem with build-time config: you need **one build per environment**. If your React app is served by ASP.NET Core, let the server give the config at runtime:

```csharp
app.MapGet("/config.json", (IOptions<ClientOptions> options) => Results.Ok(options.Value));
```

```js
// main.jsx — load the config before rendering
async function start() {
  const config = await fetch('/config.json').then((r) => r.json());

  const store = createStore(config);   // e.g. pass config.apiUrl to RTK Query's baseUrl

  createRoot(document.getElementById('root')).render(
    <Provider store={store}>
      <App />
    </Provider>
  );
}

start();
```

The same build goes to test and production. Only the server's configuration changes — and it uses all the rules we saw above.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Remember the order: json → env.json → secrets → env vars → command line | The last provider wins |
| Use the Options pattern with a `Section` constant | No magic strings, strongly typed |
| Always `ValidateOnStart()` | Wrong config = the app refuses to start |
| Avoid `Get<T>() ?? new T()` | It hides typos behind default values |
| `IOptions` by default, `IOptionsMonitor` in workers | Choose who sees live changes |
| Secrets: User Secrets in dev, env vars / Key Vault in prod | Nothing secret in Git |
| Read connection strings once, in a factory | Fail fast, easy to test |
| Windows services: use the content root, not the current directory | The service starts in System32 |
| Nothing secret in `VITE_` variables | They're public in the bundle |
| Serve front-end config at runtime when possible | One build for every environment |

>
> ## That's it & see you soon!.
>
