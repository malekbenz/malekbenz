---
layout: post
title: "FluentValidation in ASP.NET Core - Write the rules once, validate everywhere"
date: 2024-04-10
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#']
categories: ['Asp.Net', '.Net']
description: 'FluentValidation in ASP.NET Core - Write the rules once, validate everywhere'
image: /images/covers/fluentvalidation-aspnet-core-validate-once.png
---

In one of my projects I searched for `ValidationProblem` and found it almost a hundred times. Behind most of them, the same four lines, copied into action after action:

```csharp
var result = _validator.Validate(request);
if (!result.IsValid)
    return ValidationProblem(new ValidationProblemDetails(result.ToDictionary()));
// ... the real work
```

The validators themselves were good — FluentValidation makes rules readable and testable. The problem was **calling** them: copied everywhere, sometimes forgotten, sometimes synchronous on async rules. Let's see how to write good rules, then how to run them **once**, in one place, for minimal APIs, controllers and MediatR — with the same error format for the React front-end.

## Why FluentValidation

With DataAnnotations, rules are attributes on the model:

```csharp
public record CreateCustomerRequest(
    [Required, MaxLength(100)] string Name,
    [Required, EmailAddress] string Email);
```

That's fine for simple cases. It gets hard when rules depend on **other properties**, on a **database**, or on **conditions**. FluentValidation puts the rules in a separate class, in plain C#:

| | DataAnnotations | FluentValidation |
|---|---|---|
| Where | Attributes on the model | A separate validator class |
| Conditional rules ("if delivery, then address required") | Custom attribute or `IValidatableObject` | `When(...)` |
| Rules on collections and nested objects | Limited | `RuleForEach`, `SetValidator` |
| Async rules (database checks) | ❌ Not in .NET 8 | ✅ `MustAsync` |
| Unit tests | Through the validation context | `TestValidate` helpers |
| Model stays clean | ❌ | ✅ |

```sql
dotnet add package FluentValidation
dotnet add package FluentValidation.DependencyInjectionExtensions
```

---

## Writing rules

```csharp
public record CreateOrderRequest(
    int CustomerId,
    string DeliveryType,          // "Pickup" or "Home"
    AddressDto? DeliveryAddress,
    List<OrderLineDto> Lines,
    string? Notes);

public record AddressDto(string Street, string City, string PostalCode);
public record OrderLineDto(string ProductCode, int Quantity, decimal UnitPrice);
```

```csharp
public sealed class CreateOrderValidator : AbstractValidator<CreateOrderRequest>
{
    public CreateOrderValidator()
    {
        RuleLevelCascadeMode = CascadeMode.Stop;     // first failing rule per property stops that property

        RuleFor(x => x.CustomerId)
            .GreaterThan(0).WithMessage("Choose a customer.");

        RuleFor(x => x.DeliveryType)
            .NotEmpty()
            .Must(t => t is "Pickup" or "Home").WithMessage("Delivery type must be Pickup or Home.");

        When(x => x.DeliveryType == "Home", () =>
        {
            RuleFor(x => x.DeliveryAddress)
                .NotNull().WithMessage("A delivery address is required for home delivery.")
                .SetValidator(new AddressValidator());   // AddressValidator: same idea as OrderLineValidator below
        });

        RuleFor(x => x.Lines)
            .NotEmpty().WithMessage("An order needs at least one line.");

        RuleForEach(x => x.Lines).SetValidator(new OrderLineValidator());

        RuleFor(x => x.Notes)
            .MaximumLength(500);
    }
}

public sealed class OrderLineValidator : AbstractValidator<OrderLineDto>
{
    public OrderLineValidator()
    {
        RuleFor(x => x.ProductCode).NotEmpty().Length(3, 20);
        RuleFor(x => x.Quantity).InclusiveBetween(1, 1000);
        RuleFor(x => x.UnitPrice).GreaterThanOrEqualTo(0);
    }
}
```

A few things worth knowing:

- **`CascadeMode.Stop`**: without it, an empty `DeliveryType` gets **two** errors ("must not be empty" *and* "must be Pickup or Home"). With it, only the first one. Users prefer one clear message per field.
- **`When(...)`**: the address rules only exist when the delivery is at home. Much clearer than an `if` inside a custom attribute.
- **`RuleForEach` + `SetValidator`**: each line is validated with its own validator, and errors come back with their path: `Lines[2].Quantity`. The front-end can show the error on the right row.
- **`WithMessage`**: write messages for **users**, not for developers. "Choose a customer." beats "'Customer Id' must be greater than '0'."

---

## Async rules & the sync Validate() trap

"This product code must exist" needs the database:

```csharp
public sealed class OrderLineValidator : AbstractValidator<OrderLineDto>
{
    public OrderLineValidator(IProductRepository products)
    {
        RuleFor(x => x.ProductCode)
            .NotEmpty()
            .MustAsync(async (code, ct) => await products.ExistsAsync(code, ct))
            .WithMessage(x => $"Unknown product '{x.ProductCode}'.");
    }
}
```

Now the trap: if any code still calls the **synchronous** `Validate(...)` on this validator, FluentValidation throws:

```sql
AsyncValidatorInvokedSynchronouslyException:
Validator "OrderLineValidator" contains asynchronous rules but was invoked synchronously.
```

And it throws at **runtime**, the first time that path runs — maybe in production. The rule: in ASP.NET Core, **always** call `ValidateAsync`. If validation lives in one place (below), there's only one call to get right.

(Since the line validator now needs a repository, register it in DI and inject it into the parent validator instead of `new OrderLineValidator()`.)

---

## Registration

```csharp
builder.Services.AddValidatorsFromAssemblyContaining<CreateOrderValidator>();
```

This registers every `AbstractValidator<T>` of the assembly as `IValidator<T>` (scoped by default). Inject `IValidator<CreateOrderRequest>` anywhere.

---

## Stop repeating: validate in one place

The goal: endpoints and actions contain **only** the real work. Validation runs before them, automatically, and always returns the same response:

```json
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "DeliveryAddress": ["A delivery address is required for home delivery."],
    "Lines[1].Quantity": ["'Quantity' must be between 1 and 1000. You entered 0."]
  }
}
```

### Minimal APIs: a generic endpoint filter

```csharp
public sealed class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var validator = context.HttpContext.RequestServices.GetService<IValidator<T>>();
        var model = context.Arguments.OfType<T>().FirstOrDefault();

        if (validator is not null && model is not null)
        {
            var result = await validator.ValidateAsync(model, context.HttpContext.RequestAborted);
            if (!result.IsValid)
                return TypedResults.ValidationProblem(result.ToDictionary());
        }

        return await next(context);
    }
}

public static class ValidationExtensions
{
    public static RouteHandlerBuilder Validate<T>(this RouteHandlerBuilder builder) where T : class =>
        builder.AddEndpointFilter<ValidationFilter<T>>()
               .ProducesValidationProblem();
}
```

```csharp
orders.MapPost("/", async (CreateOrderRequest request, IOrderService service) =>
{
    var order = await service.CreateAsync(request);     // only the real work
    return TypedResults.Created($"/api/orders/{order.Id}", order);
})
.Validate<CreateOrderRequest>();
```

`ProducesValidationProblem()` also documents the 400 response in OpenAPI.

### Controllers: an action filter

For controllers, one global filter validates **every** action argument that has a validator:

```csharp
public sealed class FluentValidationActionFilter(IServiceProvider services) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        foreach (var argument in context.ActionArguments.Values)
        {
            if (argument is null) continue;

            var validatorType = typeof(IValidator<>).MakeGenericType(argument.GetType());
            if (services.GetService(validatorType) is not IValidator validator) continue;

            var result = await validator.ValidateAsync(
                new ValidationContext<object>(argument), context.HttpContext.RequestAborted);

            if (!result.IsValid)
            {
                context.Result = new BadRequestObjectResult(new ValidationProblemDetails(result.ToDictionary()));
                return;     // the action never runs
            }
        }

        await next();
    }
}

builder.Services.AddControllers(options => options.Filters.Add<FluentValidationActionFilter>());
```

Now every controller action is validated, and the copied four lines can be deleted everywhere.

**What about `AddFluentValidationAutoValidation()`?** That's the old integration from the `FluentValidation.AspNetCore` package. It plugs into MVC's synchronous validation pipeline, so it **can't run async rules**, and the FluentValidation author no longer recommends it (the package isn't maintained anymore). If you still have it, replace it with a filter like the one above.

### MediatR: a validation pipeline behavior

If your actions only send commands with MediatR, validate the **commands** instead — then it works the same whether the command comes from a controller, a minimal API or a background job:

```csharp
public sealed class ValidationBehavior<TRequest, TResponse>(IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse> where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        if (!validators.Any())
            return await next();

        var context = new ValidationContext<TRequest>(request);
        var results = await Task.WhenAll(validators.Select(v => v.ValidateAsync(context, ct)));
        var failures = results.SelectMany(r => r.Errors).ToList();

        if (failures.Count > 0)
            throw new ValidationException(failures);

        return await next();
    }
}

builder.Services.AddMediatR(cfg =>
{
    cfg.RegisterServicesFromAssemblyContaining<Program>();
    cfg.AddOpenBehavior(typeof(ValidationBehavior<,>));
});
```

The behavior **throws** a `ValidationException`; one global exception handler turns it into the same 400 `ValidationProblemDetails`. (That's exactly the topic of next month's post on `IExceptionHandler`.)

| Style | Where validation runs |
|---|---|
| Minimal APIs | `ValidationFilter<T>` endpoint filter |
| Controllers | Global `IAsyncActionFilter` |
| MediatR | `IPipelineBehavior` + exception handler |

---

## The same error shape for React

Because all three paths return `ValidationProblemDetails`, the front-end needs **one** function to map errors to fields:

```js
// errors: { "DeliveryAddress": ["..."], "Lines[1].Quantity": ["..."] }
export function applyServerErrors(problem, setError) {
  for (const [field, messages] of Object.entries(problem.errors ?? {})) {
    setError(field, { type: 'server', message: messages[0] });
  }
}
```

Field names come from the C# property paths (`DeliveryAddress`, `Lines[1].Quantity`). If your React forms use camelCase, convert the keys in one place on the server, or in this function. We'll use this with React Hook Form in the next post.

---

## Testing validators

Validators are plain classes — test them without HTTP:

```csharp
public class CreateOrderValidatorTests
{
    private readonly CreateOrderValidator _validator = new();

    [Fact]
    public void Home_delivery_requires_an_address()
    {
        var request = new CreateOrderRequest(42, "Home", DeliveryAddress: null,
            Lines: [new("ABC-1", 2, 10m)], Notes: null);

        var result = _validator.TestValidate(request);

        result.ShouldHaveValidationErrorFor(x => x.DeliveryAddress)
              .WithErrorMessage("A delivery address is required for home delivery.");
    }

    [Fact]
    public void Pickup_does_not_need_an_address()
    {
        var request = new CreateOrderRequest(42, "Pickup", null, [new("ABC-1", 2, 10m)], null);

        _validator.TestValidate(request).ShouldNotHaveValidationErrorFor(x => x.DeliveryAddress);
    }
}
```

`TestValidate` and the `Should...` helpers come with FluentValidation (`FluentValidation.TestHelper` namespace). For validators with async rules, use `TestValidateAsync`.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Rules in validator classes, models stay clean | Readable, reusable, testable |
| `CascadeMode.Stop` per rule | One clear error per field |
| `When(...)` for conditional rules | No custom attributes for "if this, then that" |
| `RuleForEach` + `SetValidator` for lists | Errors with paths like `Lines[2].Quantity` |
| User-friendly `WithMessage` | Messages are shown to users |
| Always `ValidateAsync` in ASP.NET Core | Sync `Validate` throws on async rules |
| `AddValidatorsFromAssemblyContaining<T>()` | All validators registered at once |
| Validate in ONE place: endpoint filter / action filter / pipeline behavior | No copied code, no forgotten validation |
| Replace `AddFluentValidationAutoValidation` | Sync-only and no longer recommended |
| Always return `ValidationProblemDetails` | The front-end maps errors with one function |
| Unit test validators with `TestValidate` | Fast tests, no HTTP |

>
> ## That's it & see you soon!.
>
