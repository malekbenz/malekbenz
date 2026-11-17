---
layout: post
title: "Controllers or Minimal APIs in .NET 8 - Which one, and how to organize them"
date: 2024-01-10
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: 'Controllers or Minimal APIs in .NET 8 - Which one, and how to organize them'
image: /images/covers/controllers-or-minimal-apis-dotnet-8.png
---

In one project I have about 60 controllers, almost every action protected with `[Authorize]`. In another, a small update service, I have 10 endpoints written as minimal APIs in a couple of files. Both work fine in production. So which one should you use for your next API? The honest answer is "it depends" — but on **what**, exactly? Let's build the same endpoint both ways, see how to organize each style when the app grows, and finish with a simple decision table.

## The core idea: same pipeline, two styles

Controllers and minimal APIs are **not** two different frameworks. They run on the same ASP.NET Core pipeline:

```sql
Request → Kestrel → Middlewares (auth, CORS, exception handler...) → Routing → Endpoint
                                                                              │
                                                    ┌─────────────────────────┴─────────┐
                                                    │ Controller action  or  Map* lambda │
                                                    └────────────────────────────────────┘
```

Same routing, same dependency injection, same authentication and authorization, same `ProblemDetails`. The difference is **how you declare** the endpoint:

| | Controllers | Minimal APIs |
|---|---|---|
| Declaration | Class + attributes (`[HttpGet]`, `[Route]`) | `app.MapGet(...)` with a lambda or a method |
| Dependencies | Constructor injection (shared by all actions) | Injected per endpoint (only what it needs) |
| Model validation | Automatic with `[ApiController]` | Manual (or a filter) in .NET 8 |
| Filters | Action filters, `[ServiceFilter]`... | Endpoint filters (`AddEndpointFilter`) |
| Startup & memory | A bit more | Less — and Native AOT compatible in .NET 8 |
| Feels like | MVC, structured from day one | Express.js / small services |

> **Choosing between them is about organization and team habits, not about what the API can do.**

---

## The same endpoint, both ways

A small product API: get one product, create one. Authenticated, with validation.

```csharp
public record ProductDto(int Id, string Name, decimal Price);
public record CreateProductRequest([Required, MaxLength(100)] string Name, [Range(0.01, 100000)] decimal Price);
```

### With a controller

```csharp
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ProductsController(IProductRepository products) : ControllerBase
{
    [HttpGet("{id:int}")]
    [ProducesResponseType<ProductDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductDto>> Get(int id)
    {
        var product = await products.GetAsync(id);
        return product is null ? NotFound() : Ok(product);
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ProductDto>> Create(CreateProductRequest request)
    {
        var product = await products.CreateAsync(request);
        return CreatedAtAction(nameof(Get), new { id = product.Id }, product);
    }
}
```

`[ApiController]` gives you two things for free: the body is bound automatically, and an invalid model (`[Required]`, `[Range]`...) returns a **400 with ValidationProblemDetails** before your code runs.

(The `(IProductRepository products)` after the class name is a C# 12 **primary constructor** — new in .NET 8.)

### With minimal APIs

```csharp
var products = app.MapGroup("/api/products")
                  .RequireAuthorization()
                  .WithTags("Products");

products.MapGet("/{id:int}", async Task<Results<Ok<ProductDto>, NotFound>> (int id, IProductRepository repo) =>
    await repo.GetAsync(id) is { } product
        ? TypedResults.Ok(product)
        : TypedResults.NotFound());

products.MapPost("/", async (CreateProductRequest request, IProductRepository repo) =>
{
    var product = await repo.CreateAsync(request);
    return TypedResults.Created($"/api/products/{product.Id}", product);
})
.RequireAuthorization(policy => policy.RequireRole("Admin"))
.AddEndpointFilter<ValidationFilter<CreateProductRequest>>();
```

Less ceremony, but notice the last line: in .NET 8, minimal APIs **don't validate DataAnnotations automatically**. We add a small filter (shown below) or use FluentValidation.

---

## Organizing controllers

With 60 controllers, the risk is not performance, it's **repetition and inconsistency**: one controller forgets `[Authorize]`, another returns errors in a different format.

### A base controller for the shared conventions

```csharp
[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase
{
    protected int CurrentUserId =>
        int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}

public class InvoicesController(IInvoiceRepository invoices) : ApiControllerBase
{
    [HttpGet]
    public Task<IEnumerable<InvoiceDto>> GetMine() => invoices.GetForUserAsync(CurrentUserId);
}
```

Attributes on the base class are **inherited**: every controller gets the route convention, JSON output and `[Authorize]` without repeating them.

### Filters for cross-cutting work

```csharp
public sealed class AuditFilter(ILogger<AuditFilter> logger) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var executed = await next();
        logger.LogInformation("{User} called {Action} → {Status}",
            context.HttpContext.User.Identity?.Name,
            context.ActionDescriptor.DisplayName,
            context.HttpContext.Response.StatusCode);
    }
}

builder.Services.AddControllers(options => options.Filters.Add<AuditFilter>());
```

### Keep controllers thin

The most common problem in big controller apps: 800-line controllers with SQL, mapping and business rules inside. A controller action should do three things: **read the request, call a service, return a result**. Everything else goes to services or repositories.

---

## Organizing minimal APIs

Minimal APIs have the opposite risk: a 2,000-line `Program.cs`. The fix is simple.

### Route groups: shared prefix, auth, tags

```csharp
var api = app.MapGroup("/api").RequireAuthorization();

api.MapGroup("/products").WithTags("Products").MapProductEndpoints();
api.MapGroup("/invoices").WithTags("Invoices").MapInvoiceEndpoints();
```

Everything set on a group (`RequireAuthorization`, tags, filters, CORS policy, rate limiting) applies to **all** endpoints inside, including nested groups.

### One file per feature

```csharp
// Features/Products/ProductEndpoints.cs
public static class ProductEndpoints
{
    public static RouteGroupBuilder MapProductEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/", GetAll);
        group.MapGet("/{id:int}", GetById);
        group.MapPost("/", Create)
             .RequireAuthorization(p => p.RequireRole("Admin"))
             .AddEndpointFilter<ValidationFilter<CreateProductRequest>>();
        return group;
    }

    private static async Task<Ok<IEnumerable<ProductDto>>> GetAll(IProductRepository repo) =>
        TypedResults.Ok(await repo.GetAllAsync());

    private static async Task<Results<Ok<ProductDto>, NotFound>> GetById(int id, IProductRepository repo) =>
        await repo.GetAsync(id) is { } product ? TypedResults.Ok(product) : TypedResults.NotFound();

    private static async Task<Created<ProductDto>> Create(CreateProductRequest request, IProductRepository repo)
    {
        var product = await repo.CreateAsync(request);
        return TypedResults.Created($"/api/products/{product.Id}", product);
    }
}
```

`Program.cs` stays a short list of groups, and each feature lives in its own folder — very close to what a controller gives you, without the base class.

### TypedResults + Results&lt;T1, T2&gt;

`Results.Ok(...)` returns `IResult`: OpenAPI can't know what the endpoint returns. `TypedResults.Ok(...)` returns `Ok<T>`, and the return type `Results<Ok<ProductDto>, NotFound>` lists **every** possible response:

```sql
Results<Ok<ProductDto>, NotFound>
   → OpenAPI documents: 200 with a ProductDto body, 404
   → unit tests can check the result type without an HTTP server
```

### A small validation filter

```csharp
public sealed class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var model = context.Arguments.OfType<T>().FirstOrDefault();
        if (model is null)
            return TypedResults.BadRequest();

        var results = new List<ValidationResult>();
        if (!Validator.TryValidateObject(model, new ValidationContext(model), results, validateAllProperties: true))
        {
            var errors = results
                .GroupBy(r => r.MemberNames.FirstOrDefault() ?? "")
                .ToDictionary(g => g.Key, g => g.Select(r => r.ErrorMessage ?? "Invalid").ToArray());

            return TypedResults.ValidationProblem(errors);
        }

        return await next(context);
    }
}
```

Same 400 + `ValidationProblemDetails` as `[ApiController]`, so the front-end handles errors the same way whatever the style.

---

## Auth by default: the fallback policy

With `[Authorize]` on 130 actions, the real danger is the **131st** that someone forgets. Flip the default: every endpoint requires an authenticated user, unless it explicitly says otherwise.

```csharp
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});
```

```csharp
// Controllers
[AllowAnonymous]
[HttpGet("health")]
public IActionResult Health() => Ok();

// Minimal APIs
app.MapGet("/health", () => "OK").AllowAnonymous();
```

The fallback policy applies to endpoints **without any** authorization metadata — in both styles. Forgetting `[Authorize]` now means "requires login", not "public". Security by default.

---

## OpenAPI in .NET 8

In .NET 8, the templates use **Swashbuckle** for both styles:

```csharp
builder.Services.AddEndpointsApiExplorer();   // needed for minimal APIs
builder.Services.AddSwaggerGen();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
```

For good documentation:

| Controllers | Minimal APIs |
|---|---|
| `ActionResult<T>` + `[ProducesResponseType]` | `TypedResults` + `Results<...>` return types |
| XML comments on actions | `.WithSummary("...")`, `.WithDescription("...")` |
| `[Tags]` or controller name | `.WithTags("...")` on the group |

---

## Mixing both in one app

Nothing stops you from using both in the same project:

```csharp
builder.Services.AddControllers();

var app = builder.Build();

app.MapControllers();                               // the existing 60 controllers
app.MapGroup("/api/reports").MapReportEndpoints();  // new features as minimal APIs
```

That's a smooth way to try minimal APIs in an existing app: keep the controllers, write the next feature with `MapGroup`, and decide later with real experience.

---

## Which one should you choose?

| Situation | Choice | Why |
|---|---|---|
| Large app, big team, many endpoints | Controllers | Strong conventions, automatic validation, familiar |
| Small service, worker with a few endpoints, BFF | Minimal APIs | Less code, less memory, faster startup |
| Native AOT / containers that must start in milliseconds | Minimal APIs | Controllers aren't AOT-compatible in .NET 8 |
| Heavy use of MVC filters, model binding customization | Controllers | Richer extensibility |
| Team coming from Node/Express | Minimal APIs | Very similar mental model |
| Existing controller app | Keep controllers, add minimal APIs for new features | No big rewrite |

---

## Key rules to remember

| Rule | Why |
|---|---|
| Both styles share the same pipeline | Middleware, DI, auth and ProblemDetails work the same |
| Controllers: a base class for conventions | Route, `[Authorize]`, JSON in one place |
| Controllers: thin actions, logic in services | No 800-line controllers |
| Minimal APIs: `MapGroup` + one file per feature | No 2,000-line `Program.cs` |
| Minimal APIs: `TypedResults` + `Results<...>` | Accurate OpenAPI and easy tests |
| Minimal APIs in .NET 8: add validation yourself | No automatic DataAnnotations validation |
| Set a fallback authorization policy | A forgotten `[Authorize]` doesn't make an endpoint public |
| Same validation response format in both styles | The React front-end handles errors once |
| You can mix both in one app | Migrate feature by feature, no rewrite |

>
> ## That's it & see you soon!.
>
