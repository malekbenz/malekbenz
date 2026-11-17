---
layout: post
title: "ASP.NET Core JWT authentication with refresh tokens - .NET 8, the right way"
date: 2024-02-07
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#', 'Security']
categories: ['Asp.Net', '.Net']
description: 'ASP.NET Core JWT authentication with refresh tokens - .NET 8, the right way'
image: /images/covers/aspnet-core-jwt-refresh-tokens-dotnet-8.png
---

The first token service I wrote worked on day one: users logged in, the API checked the token, everybody was happy. Then the problems came one by one. The tokens lived for hours, so a stolen one was useful for hours. The refresh tokens were kept in memory, so every restart logged everybody out — and with two API instances, half the refresh requests failed. Logging in on a second device logged out the first. And the "revoke" method never revoked anything. Let's build JWT authentication with refresh tokens in .NET 8 properly, and see why each of those details matters.

## How a JWT works

A JWT (JSON Web Token) is three base64url parts separated by dots:

```sql
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiI0MiIsInJvbGUiOiJBZG1pbiIsImV4cCI6MTcwNzMxMjAwMH0 . 3kF9...signature
└──── header ─────┘   └──────────────────────── payload (claims) ─────────────────┘   └─ signature ─┘

header  : { "alg": "HS256" }
payload : { "sub": "42", "role": "Admin", "exp": 1707312000 }
```

- The server **signs** header + payload with a secret key. Anybody changing one character of the payload breaks the signature.
- The API checks the signature and the expiration **without any database call**. That's why JWTs are fast and scale well.
- The payload is only **encoded, not encrypted**. Paste a token in any JWT decoder and you read it. Never put secrets or sensitive data in claims.

> **A JWT is like a cinema ticket: anyone holding it gets in, and you can't cancel it once printed. So it must expire quickly.**

That last point is the whole reason for refresh tokens.

---

## Access token + refresh token

```sql
             ┌───────────────────────────── short-lived ─────────────────────────────┐
POST /auth/login ──► access token (JWT, 15 min) + refresh token (random, 14 days)
                     │
GET /api/orders      ├── Authorization: Bearer <access token>  ✅ (no DB call)
...15 minutes later  │
GET /api/orders      ├── 401 (expired)
POST /auth/refresh   └── refresh token ──► NEW access token + NEW refresh token (rotation)
POST /auth/logout        refresh token ──► revoked in the database
```

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (signed claims) | Random string (opaque) |
| Lifetime | Short: 5–15 minutes | Long: days or weeks |
| Checked by | Every API, from the signature | Only the auth endpoint, in the **database** |
| Can be revoked? | ❌ Not before it expires | ✅ Yes, it's a row in a table |
| Sent | On every request | Only to `/auth/refresh` |

The access token is fast and stateless; the refresh token is slow but controllable. Together you get both.

---

## Settings with validation

```json
{
  "Jwt": {
    "Issuer": "https://auth.example.com",
    "Audience": "example-api",
    "Key": "",
    "AccessTokenMinutes": 15,
    "RefreshTokenDays": 14
  }
}
```

The `Key` is empty in the file and comes from User Secrets in development and an environment variable (`Jwt__Key`) on servers.

```csharp
public sealed class JwtOptions
{
    public const string Section = "Jwt";

    [Required] public string Issuer { get; init; } = "";
    [Required] public string Audience { get; init; } = "";
    [Required, MinLength(64)] public string Key { get; init; } = "";   // 64 chars → enough for HS256 and HS512
    [Range(1, 60)] public int AccessTokenMinutes { get; init; } = 15;
    [Range(1, 90)] public int RefreshTokenDays { get; init; } = 14;
}

builder.Services.AddOptions<JwtOptions>()
    .BindConfiguration(JwtOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

An empty or short key stops the app **at startup** instead of producing tokens signed with a weak (or empty!) key.

---

## Issuing the access token

In .NET 8, the recommended handler is `JsonWebTokenHandler` (from `Microsoft.IdentityModel.JsonWebTokens`). It's faster than the old `JwtSecurityTokenHandler`, and it's what `AddJwtBearer` uses by default since .NET 8.

```csharp
public sealed class AccessTokenService(IOptions<JwtOptions> options, TimeProvider clock)
{
    private readonly JwtOptions _jwt = options.Value;
    private readonly JsonWebTokenHandler _handler = new();

    public (string Token, DateTime ExpiresAt) Create(AppUser user, IEnumerable<string> roles)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var expires = now.AddMinutes(_jwt.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.UniqueName, user.UserName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };
        claims.AddRange(roles.Select(r => new Claim("role", r)));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _jwt.Issuer,
            Audience = _jwt.Audience,
            Subject = new ClaimsIdentity(claims),
            NotBefore = now,
            Expires = expires,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Key)),
                SecurityAlgorithms.HmacSha256)
        };

        return (_handler.CreateToken(descriptor), expires);
    }
}
```

Keep the claims **small**: an id, a name, roles. The token travels on every request, and everything in it stays true until it expires — if you put "is premium" in the token and the user cancels, the API believes the old value for 15 more minutes.

(`TimeProvider`, new in .NET 8, makes the expiration logic testable: register `builder.Services.AddSingleton(TimeProvider.System)`, and inject a fake clock in tests.)

---

## Validating it in the API

```csharp
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var jwt = builder.Configuration.GetSection(JwtOptions.Section).Get<JwtOptions>()!;

        options.MapInboundClaims = false;          // keep "sub", "role"... as they are in the token
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),  // default is 5 minutes!
            NameClaimType = JwtRegisteredClaimNames.UniqueName,
            RoleClaimType = "role",
        };
    });

builder.Services.AddAuthorization();
```

Three settings people often miss:

| Setting | Default | Why change it |
|---|---|---|
| `ClockSkew` | **5 minutes** | A "15-minute" token is actually valid for 20 minutes |
| `MapInboundClaims` | `true` | Renames `sub` to a long `http://schemas.xmlsoap.org/...` URI — confusing in code |
| `NameClaimType` / `RoleClaimType` | Long URIs | `User.Identity.Name` and `[Authorize(Roles = ...)]` must read your claim names |

---

## Refresh tokens: in the database, hashed

My first version stored refresh tokens in a static `ConcurrentDictionary<userId, token>`. Simple, and wrong in four ways:

```sql
❌ In memory          → an app restart or a deployment logs everybody out
❌ Per instance        → with 2 API instances, a refresh on the "other" one fails
❌ One per user        → logging in on the phone logs out the laptop
❌ No expiry/history   → can't detect a stolen token, can't audit sessions
```

A table fixes all of them:

```sql
CREATE TABLE RefreshTokens
(
    Id            BIGINT IDENTITY PRIMARY KEY,
    UserId        INT            NOT NULL,
    TokenHash     CHAR(64)       NOT NULL UNIQUE,   -- SHA-256 hex, never the token itself
    FamilyId      UNIQUEIDENTIFIER NOT NULL,         -- all tokens of one login session
    DeviceName    NVARCHAR(100)  NULL,
    CreatedAt     DATETIME2      NOT NULL,
    ExpiresAt     DATETIME2      NOT NULL,
    RevokedAt     DATETIME2      NULL,
    ReplacedByHash CHAR(64)      NULL
);

CREATE INDEX IX_RefreshTokens_User ON RefreshTokens (UserId) INCLUDE (RevokedAt, ExpiresAt);
```

Why store a **hash**? The refresh token is a password-like secret valid for 14 days. If the database leaks, hashed tokens are useless to the attacker. SHA-256 is enough here because the token is long and random (no need for a slow password hash).

### Generating a real random token

```csharp
public static class RefreshTokenGenerator
{
    public static string Create() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));   // 512 bits of real randomness

    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
```

Not `Guid.NewGuid()`: a GUID is made to be **unique**, not **unpredictable**, and it only has 122 random bits in the best case. `RandomNumberGenerator` is the cryptographic generator — use it for anything secret.

---

## The endpoints: login, refresh, logout

```csharp
var auth = app.MapGroup("/auth").AllowAnonymous();

auth.MapPost("/login", async (LoginRequest request, IUserService users,
    AccessTokenService tokens, RefreshTokenStore store) =>
{
    var user = await users.ValidateCredentialsAsync(request.UserName, request.Password);
    if (user is null)
        return Results.Unauthorized();          // same answer for "unknown user" and "wrong password"

    var (access, expires) = tokens.Create(user, await users.GetRolesAsync(user.Id));
    var refresh = await store.CreateAsync(user.Id, familyId: Guid.NewGuid(), request.DeviceName);

    return Results.Ok(new TokenResponse(access, expires, refresh));
});
```

### Refresh with rotation and reuse detection

Each refresh token can be used **once**. Using it returns a new pair and marks the old one as replaced:

```csharp
auth.MapPost("/refresh", async (RefreshRequest request, RefreshTokenStore store,
    IUserService users, AccessTokenService tokens) =>
{
    var current = await store.FindAsync(RefreshTokenGenerator.Hash(request.RefreshToken));

    if (current is null || current.ExpiresAt < DateTime.UtcNow)
        return Results.Unauthorized();

    if (current.RevokedAt is not null)
    {
        // An already-used token is presented again: someone copied it.
        // Revoke the whole session (family) — the thief AND the real user must log in again.
        await store.RevokeFamilyAsync(current.FamilyId);
        return Results.Unauthorized();
    }

    var user = await users.GetAsync(current.UserId);
    if (user is null || !user.IsActive)
        return Results.Unauthorized();

    var newRefresh = await store.RotateAsync(current);       // revoke current + create the next one in the same family
    if (newRefresh is null)
        return Results.Unauthorized();

    var (access, expires) = tokens.Create(user, await users.GetRolesAsync(user.Id));

    return Results.Ok(new TokenResponse(access, expires, newRefresh));
});
```

```sql
Normal use:   R1 → (refresh) → R2 → (refresh) → R3 ...        each one used once ✅
Stolen R2:    thief uses R2 → gets R3'      real user later uses R2 → already used!
              → whole family revoked → R3' stops working too  🔒
```

The refresh endpoint is also the right place to check that the user is **still active**: a disabled account can't get new access tokens, so it loses access within 15 minutes at most.

### Logout

```csharp
auth.MapPost("/logout", async (RefreshRequest request, RefreshTokenStore store) =>
{
    await store.RevokeAsync(RefreshTokenGenerator.Hash(request.RefreshToken));
    return Results.NoContent();
});
```

Revoke **by the token** you received, and look it up the way it's stored (its hash). My old version stored tokens by user id but tried to remove them by token value — the remove always "succeeded" silently and never removed anything. A test for logout would have caught it in seconds.

### The store, with Dapper

```csharp
public sealed class RefreshTokenStore(IDbConnectionFactory db, IOptions<JwtOptions> options)
{
    public async Task<string> CreateAsync(int userId, Guid familyId, string? deviceName)
    {
        var token = RefreshTokenGenerator.Create();
        using var connection = db.Create();

        await connection.ExecuteAsync(@"
            INSERT INTO RefreshTokens (UserId, TokenHash, FamilyId, DeviceName, CreatedAt, ExpiresAt)
            VALUES (@UserId, @Hash, @FamilyId, @DeviceName, SYSUTCDATETIME(), DATEADD(DAY, @Days, SYSUTCDATETIME()))",
            new { UserId = userId, Hash = RefreshTokenGenerator.Hash(token), FamilyId = familyId,
                  DeviceName = deviceName, Days = options.Value.RefreshTokenDays });

        return token;     // the only time the clear token exists: sent to the client, never stored
    }

    public async Task<string?> RotateAsync(RefreshTokenRow current)
    {
        var next = RefreshTokenGenerator.Create();
        using var connection = db.Create();

        // Only one request can rotate a token: the WHERE RevokedAt IS NULL makes it atomic
        var updated = await connection.ExecuteAsync(@"
            UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME(), ReplacedByHash = @Next
            WHERE Id = @Id AND RevokedAt IS NULL",
            new { current.Id, Next = RefreshTokenGenerator.Hash(next) });

        if (updated == 0)
            return null;      // a parallel request already used this token

        await connection.ExecuteAsync(@"
            INSERT INTO RefreshTokens (UserId, TokenHash, FamilyId, DeviceName, CreatedAt, ExpiresAt)
            VALUES (@UserId, @Hash, @FamilyId, @DeviceName, SYSUTCDATETIME(), DATEADD(DAY, @Days, SYSUTCDATETIME()))",
            new { current.UserId, Hash = RefreshTokenGenerator.Hash(next), current.FamilyId,
                  current.DeviceName, Days = options.Value.RefreshTokenDays });

        return next;
    }

    // FindAsync, RevokeAsync, RevokeFamilyAsync: simple SELECT / UPDATE by TokenHash or FamilyId
}
```

One row per **session** (device), not per user: the phone and the laptop each have their family, and "log out everywhere" is just `UPDATE ... WHERE UserId = @UserId`. Add a nightly job that deletes expired rows.

---

## Where should the client keep the tokens?

| Option | Risk | Good for |
|---|---|---|
| Refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie, access token in memory | JavaScript can't read the refresh token (XSS-safe); needs CSRF care | Browser apps (React) on the same site |
| Both in `localStorage` | Any XSS can steal both | Avoid for refresh tokens |
| Secure storage (Keychain, Keystore, DPAPI) | Low | Mobile and desktop apps, Windows services |

For a browser app, setting the refresh token as a cookie is a small change in the endpoint:

```csharp
http.Response.Cookies.Append("refresh_token", refresh, new CookieOptions
{
    HttpOnly = true,
    Secure = true,
    SameSite = SameSiteMode.Strict,
    Path = "/auth",                                  // only sent to the auth endpoints
    Expires = DateTimeOffset.UtcNow.AddDays(14)
});
```

How the React side refreshes automatically (and retries the failed request) is the subject of the next post.

---

## What about the new .NET 8 Identity endpoints?

.NET 8 added `AddIdentityApiEndpoints` + `MapIdentityApi`: ready-made `/register`, `/login`, `/refresh`, 2FA and password reset endpoints on top of ASP.NET Core Identity.

```csharp
builder.Services.AddIdentityApiEndpoints<IdentityUser>()
    .AddEntityFrameworkStores<AppDbContext>();

app.MapGroup("/account").MapIdentityApi<IdentityUser>();
```

Good to know: the tokens they return are **not JWTs** — they're opaque tokens protected by ASP.NET Core Data Protection, readable only by apps sharing the same keys. Perfect for one API with its own front-end. When several separate APIs (or other platforms) must validate the token themselves, a JWT issued as above — or a real identity server — is the better fit.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Access tokens short (5–15 min), refresh tokens long | A stolen JWT can't be revoked — it must expire fast |
| Validate the key at startup (`MinLength`, `ValidateOnStart`) | No tokens signed with an empty or weak key |
| Small claims, nothing sensitive | The payload is readable and stays "true" until expiry |
| Set `ClockSkew` (default 5 min) and `MapInboundClaims = false` | Real lifetimes, readable claim names |
| Refresh tokens in the database, one row per session | Survive restarts, work with many instances and devices |
| Store a SHA-256 hash, generate with `RandomNumberGenerator` | A DB leak is useless, tokens are unpredictable |
| Rotate on every refresh, revoke the family on reuse | Stolen refresh tokens are detected |
| Check the user is still active on refresh | Disabled accounts lose access within minutes |
| Revoke by the stored value, and test logout | The silent "revoke that never revokes" bug |
| Browser: refresh token in an HttpOnly cookie | XSS can't steal it |

>
> ## That's it & see you soon!.
>
