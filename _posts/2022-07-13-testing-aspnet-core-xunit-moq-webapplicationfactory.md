---
layout: post
title: "Testing ASP.NET Core - Unit tests with xUnit and Moq, integration tests with WebApplicationFactory"
date: 2022-07-13
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'Asp.Net', 'C#', 'Testing']
categories: ['.Net', 'Asp.Net']
description: 'Testing ASP.NET Core - Unit tests with xUnit and Moq, integration tests with WebApplicationFactory'
image: /images/covers/testing-aspnet-core-xunit-moq-webapplicationfactory.png
---

The unit tests are all green — 100% of the `OrderService` methods covered. In production, the endpoint returns 500: the service was never registered in DI. Another day, the opposite: a single "integration test" starts the whole app, calls the database, and takes 40 seconds to tell you a discount was computed wrong. Both teams tested — just at the wrong level. Let's see the two kinds of tests every ASP.NET Core app needs: **unit tests** with xUnit and Moq for the logic, and **integration tests** with `WebApplicationFactory` for the wiring — and what to test where.

## The core idea: logic vs wiring

```sql
Unit test           → one class, its dependencies faked     → milliseconds   → "is the rule correct?"
Integration test    → the real app, real HTTP pipeline,      → ~100s of ms    → "does it work together?"
                      real DI, often a real database
```

| Bug | Caught by |
|---|---|
| Discount computed wrong | Unit test |
| Service not registered in DI | Integration test |
| Route typo, wrong HTTP method | Integration test |
| Missing `[Authorize]`, wrong status code | Integration test |
| SQL / EF mapping error | Integration test with a real database |
| Edge cases of a business rule (empty cart, max quantity) | Unit tests (many of them, fast) |

> **Unit tests prove your rules are right. Integration tests prove your app is put together right. You need both.**

---

## xUnit basics

```sql
dotnet new xunit -n Malekbenz.Tests
dotnet add Malekbenz.Tests reference Malekbenz.Api
dotnet add Malekbenz.Tests package Moq
dotnet add Malekbenz.Tests package Microsoft.AspNetCore.Mvc.Testing
```

```csharp
public class DiscountCalculatorTests
{
    [Fact]
    public void No_discount_under_100_euros()
    {
        // Arrange
        var calculator = new DiscountCalculator();

        // Act
        var discount = calculator.For(total: 99.99m, isVip: false);

        // Assert
        Assert.Equal(0m, discount);
    }

    [Theory]
    [InlineData(100, false, 5)]
    [InlineData(500, false, 25)]
    [InlineData(100, true, 15)]
    public void Discount_depends_on_total_and_vip(decimal total, bool isVip, decimal expected)
    {
        var discount = new DiscountCalculator().For(total, isVip);
        Assert.Equal(expected, discount);
    }
}
```

- **`[Fact]`**: one test, no parameters.
- **`[Theory]` + `[InlineData]`**: the same test with several inputs — perfect for business rules.
- **Arrange / Act / Assert**: three blocks, every test the same shape.
- **Name tests as sentences** about behavior: when one fails, the name already tells you what broke.

xUnit creates a **new instance of the test class for each test**: the constructor is your per-test setup, and tests can't leak state into each other.

---

## Mocking with Moq

`OrderService` depends on a repository and a mailer. In a unit test we don't want a database or real emails — we replace them with **mocks**:

```csharp
public class OrderService
{
    private readonly IOrderRepository _orders;
    private readonly IMailer _mailer;

    public OrderService(IOrderRepository orders, IMailer mailer)
    {
        _orders = orders;
        _mailer = mailer;
    }

    public async Task<bool> CancelAsync(int orderId)
    {
        var order = await _orders.GetAsync(orderId);
        if (order is null || order.Status == "Shipped")
            return false;

        order.Status = "Cancelled";
        await _orders.SaveAsync(order);
        await _mailer.SendAsync(order.Email, "Your order was cancelled");
        return true;
    }
}
```

```csharp
public class OrderServiceTests
{
    private readonly Mock<IOrderRepository> _orders = new();
    private readonly Mock<IMailer> _mailer = new();
    private readonly OrderService _sut;                    // "system under test"

    public OrderServiceTests() => _sut = new OrderService(_orders.Object, _mailer.Object);

    [Fact]
    public async Task Cancelling_a_new_order_saves_it_and_sends_an_email()
    {
        var order = new Order { Id = 42, Status = "New", Email = "jane@example.com" };
        _orders.Setup(r => r.GetAsync(42)).ReturnsAsync(order);

        var result = await _sut.CancelAsync(42);

        Assert.True(result);
        Assert.Equal("Cancelled", order.Status);
        _orders.Verify(r => r.SaveAsync(order), Times.Once);
        _mailer.Verify(m => m.SendAsync("jane@example.com", It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task A_shipped_order_cannot_be_cancelled()
    {
        _orders.Setup(r => r.GetAsync(42)).ReturnsAsync(new Order { Id = 42, Status = "Shipped" });

        var result = await _sut.CancelAsync(42);

        Assert.False(result);
        _orders.Verify(r => r.SaveAsync(It.IsAny<Order>()), Times.Never);
        _mailer.Verify(m => m.SendAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }
}
```

| Moq | Meaning |
|---|---|
| `Setup(...).ReturnsAsync(x)` | When called like this, return `x` (async) |
| `Setup(...).ThrowsAsync(ex)` | Simulate a failure |
| `It.IsAny<T>()`, `It.Is<T>(x => ...)` | Match any argument / a condition |
| `Verify(..., Times.Once)` | Check a call happened (or `Times.Never`) |

### What NOT to mock

- **`DbContext`**: mocking `DbSet` is painful and proves nothing about your queries. Put data access behind a repository (mock that in unit tests), and test the repository itself in integration tests against a real database.
- **`HttpClient`**: don't mock the class; give it a **fake handler** that returns the response you want:

```csharp
public class FakeHandler : HttpMessageHandler
{
    private readonly HttpResponseMessage _response;
    public FakeHandler(HttpResponseMessage response) => _response = response;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
        Task.FromResult(_response);
}

var http = new HttpClient(new FakeHandler(new HttpResponseMessage(HttpStatusCode.OK)
{
    Content = JsonContent.Create(new { currency = "EUR", value = 1.08m })
})) { BaseAddress = new Uri("https://rates.test") };

var client = new RatesClient(http);    // the typed client from the HttpClientFactory post
```

- **Your own simple classes** (calculators, mappers, value objects): use the real ones. Mock **boundaries** (database, network, time, email), not everything.

---

## Integration tests with WebApplicationFactory

`WebApplicationFactory<Program>` starts your **real** app in memory — real `Program.cs`, real DI, real middleware — and gives you an `HttpClient` to call it. No network, no IIS, no port.

(Remember from the [.NET 6 hosting post](/blog/2022/01/12/dotnet-6-minimal-hosting-startup-to-program): with top-level statements, add `public partial class Program { }` at the end of `Program.cs`.)

```csharp
public class OrdersApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public OrdersApiTests(WebApplicationFactory<Program> factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Unknown_order_returns_404()
    {
        var response = await _client.GetAsync("/api/orders/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
```

This one test already checks routing, DI registration, the controller, serialization and the status code.

### Replacing services for tests

Swap what you can't use in tests (real email, payment gateway) with `ConfigureTestServices`:

```csharp
public class ShopApiFactory : WebApplicationFactory<Program>
{
    public Mock<IMailer> Mailer { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IMailer>();
            services.AddSingleton(Mailer.Object);       // no real emails, and we can Verify calls
        });
    }
}
```

### A real test database

For queries and mappings, test against the **same database engine** as production — SQL Server, not an in-memory provider that behaves differently (no real SQL, no transactions, different case sensitivity). Two common options:

- **SQL Server LocalDB** on developer machines, a unique database name per test run;
- a **SQL Server Docker container** started for the test run (works the same on every machine and in CI).

```csharp
builder.ConfigureTestServices(services =>
{
    services.RemoveAll<DbContextOptions<ShopContext>>();
    services.AddDbContext<ShopContext>(o => o.UseSqlServer(
        $"Server=(localdb)\\MSSQLLocalDB;Database=ShopTests_{Guid.NewGuid():N};Trusted_Connection=True"));
});
```

Create the schema once per test class (`EnsureCreated` or your migrations), and give each test its **own data** (unique ids, names) so tests don't depend on each other's leftovers.

### Fake authentication

To test `[Authorize]` endpoints without a real login, register a test authentication handler that always signs in a known user:

```csharp
public class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger,
        UrlEncoder encoder, ISystemClock clock) : base(options, logger, encoder, clock) { }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, "42"), new Claim(ClaimTypes.Role, "Admin") };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, "Test")));
    }
}

// in ConfigureTestServices
services.AddAuthentication("Test")
        .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
```

And keep **one** test without it, checking that the real app returns `401` for anonymous calls — that's the test that catches a forgotten `[Authorize]`.

---

## Test data builders and fixtures

Tests full of `new Order { Id = 1, Status = "New", Email = ..., Lines = ... }` are hard to read. A small builder gives sensible defaults and lets each test state only what matters:

```csharp
public class OrderBuilder
{
    private readonly Order _order = new() { Id = 1, Status = "New", Email = "test@example.com" };

    public OrderBuilder Shipped() { _order.Status = "Shipped"; return this; }
    public OrderBuilder WithId(int id) { _order.Id = id; return this; }
    public Order Build() => _order;
}

var order = new OrderBuilder().WithId(42).Shipped().Build();
```

For expensive setup shared by a test class (the app factory, a database), use **`IClassFixture<T>`**: created once for the class, disposed after its last test.

---

## Running tests in CI

```sql
dotnet test --configuration Release --logger "trx" --collect:"XPlat Code Coverage"
```

Run them on every pull request. Coverage is a useful **map** (which code is never tested?), not a goal: 100% coverage with no meaningful assertions proves nothing.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Unit tests for rules, integration tests for wiring | Each catches bugs the other misses |
| Arrange / Act / Assert, names as behavior sentences | Readable tests, clear failures |
| `[Theory]` for business rules with many cases | Many cases, little code |
| Mock boundaries (DB, network, email, time), not everything | Tests stay meaningful |
| Don't mock `DbContext` or `HttpClient` — repository / fake handler | Less pain, more realistic |
| `WebApplicationFactory<Program>` tests the real pipeline | Routing, DI, auth, status codes |
| Replace external services with `ConfigureTestServices` | No real emails or payments in tests |
| Test queries against the real database engine | In-memory providers behave differently |
| Fake auth for most tests, one real 401 test | Catches the forgotten `[Authorize]` |
| Builders for test data, fixtures for expensive setup | Short tests, fast suites |

>
> ## That's it & see you soon!.
>
