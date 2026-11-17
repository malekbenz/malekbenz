---
layout: post
title: ".NET 6 minimal hosting - From Startup.cs to the new Program.cs"
date: 2022-01-12
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: '.NET 6 minimal hosting - From Startup.cs to the new Program.cs'
image: /images/covers/dotnet-6-minimal-hosting-startup-to-program.png
---

You create a new ASP.NET Core project with .NET 6, open it, and... where is `Startup.cs`? Where are `ConfigureServices` and `Configure`? There are no `using` lines at the top of the files, `Program.cs` has no class and no `Main` method, and yet everything works. .NET 6 (released in November 2021, and the new LTS version) introduced the **minimal hosting model**. Nothing was removed — the same building blocks are just put together in a much shorter way. Let's map the old structure to the new one, migrate an existing app step by step, and look at the traps.

## The core idea: one file, top to bottom

```csharp
var builder = WebApplication.CreateBuilder(args);   // 1. configure services

builder.Services.AddControllers();

var app = builder.Build();                          // 2. build the app

app.UseHttpsRedirection();                          // 3. configure the pipeline
app.MapControllers();

app.Run();                                          // 4. run
```

That's a complete web API. The file uses **top-level statements** (C# 9/10): the compiler generates the `Program` class and `Main` method for you.

```sql
WebApplication.CreateBuilder(args)  →  config, logging, DI container, Kestrel   (was Host.CreateDefaultBuilder + ConfigureWebHostDefaults)
builder.Services                    →  register services                       (was Startup.ConfigureServices)
builder.Build()                     →  creates the WebApplication
app.Use... / app.Map...             →  middleware and endpoints                (was Startup.Configure)
app.Run()                           →  start the server                        (was host.Run())
```

> **Same pieces, same order, same behavior — just without the ceremony of two classes and three methods.**

---

## The same app, before and after

### Before (.NET 5 and earlier)

```csharp
// Program.cs
public class Program
{
    public static void Main(string[] args) =>
        CreateHostBuilder(args).Build().Run();

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .ConfigureWebHostDefaults(web => web.UseStartup<Startup>());
}

// Startup.cs
public class Startup
{
    public Startup(IConfiguration configuration) => Configuration = configuration;
    public IConfiguration Configuration { get; }

    public void ConfigureServices(IServiceCollection services)
    {
        services.AddControllers();
        services.AddDbContext<ShopContext>(o =>
            o.UseSqlServer(Configuration.GetConnectionString("Shop")));
        services.AddScoped<IProductRepository, ProductRepository>();
    }

    public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
    {
        if (env.IsDevelopment())
            app.UseDeveloperExceptionPage();

        app.UseHttpsRedirection();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseEndpoints(endpoints => endpoints.MapControllers());
    }
}
```

### After (.NET 6)

```csharp
// Program.cs — the whole startup
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddDbContext<ShopContext>(o =>
    o.UseSqlServer(builder.Configuration.GetConnectionString("Shop")));
builder.Services.AddScoped<IProductRepository, ProductRepository>();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
```

Two classes and ~45 lines become one file of ~15 lines. A few things disappeared without anyone noticing:

- **`UseDeveloperExceptionPage()`** — `WebApplication` adds it automatically in the Development environment.
- **`UseRouting()` / `UseEndpoints()`** — `WebApplication` adds routing for you, and `app.MapControllers()` registers the endpoints directly. (You can still call `app.UseRouting()` explicitly when a middleware must run after routing, like CORS with endpoint metadata.)

---

## Where things went

| .NET 5 | .NET 6 |
|---|---|
| `Startup.ConfigureServices(IServiceCollection services)` | `builder.Services` |
| `Startup.Configuration` | `builder.Configuration` (before Build), `app.Configuration` (after) |
| `IWebHostEnvironment env` parameter | `builder.Environment` / `app.Environment` |
| `ConfigureLogging(...)` on the host | `builder.Logging` |
| `host.UseSerilog()`, `UseWindowsService()` | `builder.Host.UseSerilog()`, `builder.Host.UseWindowsService()` |
| `webBuilder.UseKestrel(...)`, `UseUrls(...)` | `builder.WebHost.ConfigureKestrel(...)`, `builder.WebHost.UseUrls(...)` |
| `Startup.Configure(IApplicationBuilder app, ...)` | `app.Use...` after `builder.Build()` |
| `app.UseEndpoints(e => e.MapControllers())` | `app.MapControllers()` |

One improvement hidden in this table: `builder.Configuration` is available **immediately**. In the old model, reading configuration while setting up the host was awkward; now you can read settings at any line, and add configuration sources on the fly:

```csharp
builder.Configuration.AddJsonFile("featureflags.json", optional: true, reloadOnChange: true);
var connectionString = builder.Configuration.GetConnectionString("Shop");
```

---

## Where did the usings go? Implicit and global usings

Open any `.cs` file in a new .NET 6 project: no `using System;`, no `using System.Linq;`. Look at the `.csproj`:

```xml
<PropertyGroup>
  <TargetFramework>net6.0</TargetFramework>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

`ImplicitUsings` makes the SDK generate a hidden file with **global usings** for the most common namespaces. For a web project, among others:

```csharp
global using System;
global using System.Collections.Generic;
global using System.Linq;
global using System.Net.Http.Json;
global using System.Threading.Tasks;
global using Microsoft.AspNetCore.Builder;
global using Microsoft.AspNetCore.Http;
global using Microsoft.Extensions.Configuration;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Hosting;
global using Microsoft.Extensions.Logging;
// ... (see obj/Debug/net6.0/<Project>.GlobalUsings.g.cs)
```

You can add your own with C# 10's `global using`, once for the whole project:

```csharp
// GlobalUsings.cs
global using Microsoft.EntityFrameworkCore;
global using Malekbenz.Api.Data;
```

And C# 10's **file-scoped namespaces** remove one level of indentation in every file:

```csharp
namespace Malekbenz.Api.Products;      // ← no braces: applies to the whole file

public class ProductRepository : IProductRepository { /* ... */ }
```

---

## Nullable reference types are on

`<Nullable>enable</Nullable>` is now in every new template. The compiler warns when something might be `null`:

```csharp
public class Product
{
    public string Name { get; set; }        // ⚠️ CS8618: non-nullable property must contain a non-null value
    public string? Description { get; set; } // ✅ explicitly optional
}
```

Fix it by saying what you mean: initialize (`= "";`), mark it nullable (`string?`), or set it in a constructor. It feels noisy for a day, then it catches real `NullReferenceException`s before they happen. When migrating an old project, enable it file by file (`#nullable enable`) instead of all at once.

---

## Middleware order still matters

The shorter syntax doesn't change the rule: middleware runs **in the order you add it**. The usual order:

| # | Middleware | Why here |
|---|---|---|
| 1 | `UseExceptionHandler` / `UseHsts` (production) | Catches errors from everything below |
| 2 | `UseHttpsRedirection` | Redirect before doing any work |
| 3 | `UseStaticFiles` | Serve files without auth / routing cost |
| 4 | `UseRouting` (optional, implicit) | Endpoint is selected from here |
| 5 | `UseCors` | Needs the endpoint, before auth |
| 6 | `UseAuthentication` | Who is the user? |
| 7 | `UseAuthorization` | Is the user allowed? |
| 8 | `MapControllers` / `MapGet` ... | The endpoints |

```csharp
// ❌ Authorization before authentication: every [Authorize] endpoint returns 401
app.UseAuthorization();
app.UseAuthentication();
```

---

## Keeping Startup.cs: it still works

Nothing forces you to migrate. The old `Host.CreateDefaultBuilder(...).UseStartup<Startup>()` code runs unchanged on .NET 6. And if you like the `Startup` class organization but want the new builder, you can call it yourself:

```csharp
var builder = WebApplication.CreateBuilder(args);

var startup = new Startup(builder.Configuration);
startup.ConfigureServices(builder.Services);

var app = builder.Build();
startup.Configure(app, app.Environment);

app.Run();
```

For big apps, a nicer middle ground is **extension methods** per feature:

```csharp
builder.Services
    .AddShopPersistence(builder.Configuration)
    .AddShopAuthentication(builder.Configuration)
    .AddShopApplication();
```

`Program.cs` stays a short table of contents; the details live next to each feature.

---

## Migrating step by step

```sql
1. Change <TargetFramework> to net6.0, update Microsoft.* packages to 6.0.x
2. Build and run — the OLD Program/Startup still works. Commit.
3. Move ConfigureServices content into builder.Services
4. Move Configure content after builder.Build(), replace UseEndpoints with Map...
5. Replace Configuration → builder.Configuration, env → app.Environment
6. Move host settings (Serilog, Windows service, Kestrel) to builder.Host / builder.WebHost
7. Delete Startup.cs, run the tests
8. Optional: ImplicitUsings, file-scoped namespaces, Nullable (step by step)
```

Small, testable steps — and at step 2 you already benefit from .NET 6's performance improvements without touching any code.

---

## Integration tests: WebApplicationFactory&lt;Program&gt;

With top-level statements, the generated `Program` class is **internal**, so test projects using `WebApplicationFactory<Program>` can't see it. Add one line at the end of `Program.cs`:

```csharp
app.Run();

public partial class Program { }   // makes Program visible to the test project
```

```csharp
public class ProductsApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public ProductsApiTests(WebApplicationFactory<Program> factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Get_products_returns_200()
    {
        var response = await _client.GetAsync("/api/products");
        response.EnsureSuccessStatusCode();
    }
}
```

(Integration testing deserves its own post — coming later this year.)

---

## Minimal APIs: a first look

The same release introduced **minimal APIs**: endpoints without controllers, directly in `Program.cs`:

```csharp
app.MapGet("/api/products/{id:int}", async (int id, IProductRepository repo) =>
    await repo.GetAsync(id) is { } product ? Results.Ok(product) : Results.NotFound());

app.MapPost("/api/products", async (CreateProductRequest request, IProductRepository repo) =>
{
    var product = await repo.CreateAsync(request);
    return Results.Created($"/api/products/{product.Id}", product);
});
```

Parameters come from the route, the query string, the body or DI — automatically. In .NET 6 they're perfect for small services; for big APIs, controllers still give you more structure (filters, conventions, model validation). Both can live in the same app.

---

## Key rules to remember

| Rule | Why |
|---|---|
| `builder.Services` = old `ConfigureServices` | Register everything before `Build()` |
| After `builder.Build()`, services are read-only | Adding a service later throws `InvalidOperationException` |
| `app.Use...` / `app.Map...` = old `Configure` | Same pipeline, same order rules |
| Routing and the developer exception page are automatic | Less boilerplate, same behavior |
| `builder.Host` / `builder.WebHost` for host settings | Serilog, Windows services, Kestrel options |
| Implicit usings + `global using` + file-scoped namespaces | Shorter files, less noise |
| Nullable is on — fix warnings, enable gradually in old code | Fewer `NullReferenceException`s |
| `Startup.cs` still works, migration is optional | Upgrade the framework first, the style later |
| `public partial class Program { }` for integration tests | `WebApplicationFactory<Program>` needs it |
| Extension methods per feature keep `Program.cs` short | A table of contents, not a 500-line file |

>
> ## That's it & see you soon!.
>
