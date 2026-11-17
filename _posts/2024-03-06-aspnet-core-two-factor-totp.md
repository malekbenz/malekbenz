---
layout: post
title: "Two-factor authentication in ASP.NET Core - TOTP with authenticator apps"
date: 2024-03-06
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'C#', 'Security']
categories: ['Asp.Net', '.Net']
description: 'Two-factor authentication in ASP.NET Core - TOTP with authenticator apps'
image: /images/covers/aspnet-core-two-factor-totp.png
---

Passwords leak. They're reused on ten websites, typed into phishing pages, and found in database dumps. A second factor — the 6-digit code from Google Authenticator, Microsoft Authenticator or any authenticator app — stops most of these attacks, because the attacker has the password but not the phone. Those codes are called **TOTP** (Time-based One-Time Passwords), and they're surprisingly simple. Let's add them to the [JWT login from last month](/blog/2024/02/07/aspnet-core-jwt-refresh-tokens-dotnet-8), with **Otp.NET** — and at the end, I'll show how I've also used TOTP between **services**, and the mistakes to avoid there.

## How TOTP works

The server and the phone share a **secret**. Each side computes the code from that secret and the **current time**:

```sql
code = HMAC-SHA1(secret, floor(unix_time / 30))  → truncated to 6 digits

10:00:00 – 10:00:29  →  482 913
10:00:30 – 10:00:59  →  071 556
10:01:00 – 10:01:29  →  930 214
```

- No network call: the phone works offline, the server just recomputes.
- Every 30 seconds (one **time step**), a new code.
- Knowing one code doesn't help to guess the next one — without the secret, it's random.

> **The secret is the real key. The QR code you scan is just a way to copy that secret into the app — once.**

TOTP is a standard (RFC 6238), which is why any authenticator app works with any website.

---

## Setup

```sql
dotnet add package Otp.NET
dotnet add package QRCoder
```

We add a few columns to the users table:

```sql
ALTER TABLE Users ADD
    TotpSecretProtected  NVARCHAR(500) NULL,   -- encrypted secret, NULL = 2FA not enabled
    TotpEnabled          BIT           NOT NULL DEFAULT 0,
    TotpLastTimeStep     BIGINT        NULL,   -- replay protection
    TwoFactorFailedCount INT           NOT NULL DEFAULT 0;

CREATE TABLE RecoveryCodes
(
    Id        INT IDENTITY PRIMARY KEY,
    UserId    INT      NOT NULL,
    CodeHash  CHAR(64) NOT NULL,
    UsedAt    DATETIME2 NULL
);
```

---

## Enrolment: secret, otpauth URI, QR code

### 1. Generate a secret

```csharp
public sealed class TotpEnrollmentService(IDataProtectionProvider dataProtection, IUserRepository users)
{
    private readonly IDataProtector _protector = dataProtection.CreateProtector("Totp.Secrets.v1");

    public async Task<EnrollmentResponse> StartAsync(AppUser user)
    {
        byte[] secret = KeyGeneration.GenerateRandomKey(20);       // 160 bits, as recommended for SHA-1
        string base32 = Base32Encoding.ToString(secret);           // the format authenticator apps expect

        // Stored encrypted, NOT enabled yet: the user must prove the app works first
        await users.SetPendingTotpSecretAsync(user.Id, _protector.Protect(base32));

        var uri = BuildOtpAuthUri("Malekbenz", user.Email, base32);
        return new EnrollmentResponse(uri, base32, QrPng(uri));
    }
}
```

### 2. The otpauth URI

Authenticator apps read a URI with this format:

```csharp
static string BuildOtpAuthUri(string issuer, string account, string base32Secret) =>
    $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(account)}" +
    $"?secret={base32Secret}&issuer={Uri.EscapeDataString(issuer)}&algorithm=SHA1&digits=6&period=30";
```

```sql
otpauth://totp/Malekbenz:jane%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Malekbenz&digits=6&period=30
```

Stay with **SHA1, 6 digits, 30 seconds**: it's what every authenticator app supports. Some apps silently ignore other values and then generate wrong codes.

### 3. The QR code

```csharp
static string QrPng(string uri)
{
    using var generator = new QRCodeGenerator();
    using var data = generator.CreateQrCode(uri, QRCodeGenerator.ECCLevel.Q);
    var png = new PngByteQRCode(data).GetGraphic(6);
    return $"data:image/png;base64,{Convert.ToBase64String(png)}";
}
```

The React page shows the image, plus the base32 secret as text ("can't scan? type this key") for users on the same device as their authenticator.

### 4. Confirm before enabling

Never enable 2FA right after showing the QR code. If the scan failed, the user is locked out at the next login. Ask for a **first code** and enable only if it's valid:

```csharp
app.MapPost("/account/2fa/confirm", async (ConfirmRequest request, ClaimsPrincipal principal,
    TotpVerifier verifier, IUserRepository users, RecoveryCodeService recovery) =>
{
    var user = await users.GetAsync(principal.GetUserId());

    if (!await verifier.VerifyAsync(user, request.Code))
        return Results.BadRequest(new { error = "Invalid code. Check the time on your phone and try again." });

    await users.EnableTotpAsync(user.Id);
    var codes = await recovery.GenerateAsync(user.Id);    // shown ONCE

    return Results.Ok(new { recoveryCodes = codes });
})
.RequireAuthorization();
```

---

## Verifying codes: time window and replay

```csharp
public sealed class TotpVerifier(IDataProtectionProvider dataProtection, IUserRepository users)
{
    private readonly IDataProtector _protector = dataProtection.CreateProtector("Totp.Secrets.v1");

    public async Task<bool> VerifyAsync(AppUser user, string code)
    {
        if (user.TotpSecretProtected is null || code.Length != 6 || !code.All(char.IsDigit))
            return false;

        var secret = Base32Encoding.ToBytes(_protector.Unprotect(user.TotpSecretProtected));
        var totp = new Totp(secret);                                     // SHA1, 30 s, 6 digits

        bool valid = totp.VerifyTotp(code, out long timeStep,
                                     VerificationWindow.RfcSpecifiedNetworkDelay);   // accept ±1 step

        if (!valid)
            return false;

        // Replay protection: a code (time step) can be used only once
        if (user.TotpLastTimeStep is { } last && timeStep <= last)
            return false;

        return await users.TrySetLastTimeStepAsync(user.Id, timeStep);   // UPDATE ... WHERE last < @step
    }
}
```

Two things that matter:

**The time window.** The user reads the code at 10:00:28, types it, presses Enter at 10:00:33 — the server is already in the next step. `RfcSpecifiedNetworkDelay` accepts the previous and next step too (about ±30 s). Without a window, users get "invalid code" a few times a day for no reason.

**Replay.** A TOTP code stays valid for its whole window. If someone sees it (over a shoulder, in a phishing proxy), they can reuse it immediately. Saving the last accepted time step — and refusing anything not newer — makes each code **one-time** for real.

---

## Login in two steps

The login from the JWT post returned tokens right after the password. With 2FA, the password only gives a **temporary ticket**:

```sql
POST /auth/login        { userName, password }
  → 2FA disabled : { accessToken, refreshToken }                     (as before)
  → 2FA enabled  : { requiresTwoFactor: true, challenge: "CfDJ8..." } (valid 5 minutes, no access to the API)

POST /auth/login/2fa    { challenge, code }
  → valid code   : { accessToken, refreshToken }
```

The challenge is the user id, encrypted and **time-limited** with Data Protection — no table needed:

```csharp
var challenges = dataProtection.CreateProtector("Auth.TwoFactorChallenge").ToTimeLimitedDataProtector();

// In /auth/login, after the password check
if (user.TotpEnabled)
{
    var challenge = challenges.Protect(user.Id.ToString(), TimeSpan.FromMinutes(5));
    return Results.Ok(new { requiresTwoFactor = true, challenge });
}
```

```csharp
auth.MapPost("/login/2fa", async (TwoFactorRequest request, IUserRepository users,
    TotpVerifier verifier, RecoveryCodeService recovery, AccessTokenService tokens, RefreshTokenStore store) =>
{
    int userId;
    try
    {
        userId = int.Parse(challenges.Unprotect(request.Challenge));   // throws if expired or tampered
    }
    catch (CryptographicException)
    {
        return Results.Unauthorized();
    }

    var user = await users.GetAsync(userId);
    if (user is null || user.IsLockedOut)
        return Results.Unauthorized();

    var ok = request.Code.Length == 6
        ? await verifier.VerifyAsync(user, request.Code)
        : await recovery.TryUseAsync(user.Id, request.Code);           // longer = recovery code

    if (!ok)
    {
        await users.RegisterTwoFactorFailureAsync(user.Id);            // lockout after 5 failures
        return Results.Unauthorized();
    }

    await users.ResetTwoFactorFailuresAsync(user.Id);
    var (access, expires) = tokens.Create(user, await users.GetRolesAsync(user.Id));
    var refresh = await store.CreateAsync(user.Id, Guid.NewGuid(), request.DeviceName);

    return Results.Ok(new TokenResponse(access, expires, refresh));
});
```

The temporary challenge is **not** a JWT: if it were, a careless API that only checks the signature could accept it as a real access token.

---

## Recovery codes

Phones get lost. Recovery codes are the backup: 10 random codes, shown **once**, each usable **once**.

```csharp
public sealed class RecoveryCodeService(IRecoveryCodeRepository repo)
{
    public async Task<string[]> GenerateAsync(int userId)
    {
        var codes = Enumerable.Range(0, 10)
            .Select(_ => Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant()) // e.g. "9f3a1c07be"
            .ToArray();

        await repo.ReplaceAllAsync(userId, codes.Select(Hash));   // old codes are invalid now
        return codes;                                             // the only time they exist in clear text
    }

    public Task<bool> TryUseAsync(int userId, string code) =>
        repo.MarkUsedAsync(userId, Hash(code.Trim().ToLowerInvariant()));  // UPDATE ... WHERE UsedAt IS NULL

    private static string Hash(string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
}
```

Same rules as refresh tokens: random from `RandomNumberGenerator`, stored as a hash, one-time use enforced in the `UPDATE`.

---

## Storing the secret: encrypted

The TOTP secret is like a second password that never changes. If your database leaks with clear secrets, the attacker can generate valid codes for every user. That's why we stored `_protector.Protect(base32)`:

- **ASP.NET Core Data Protection** encrypts with keys stored **outside** the database (file system, Azure Key Vault, Redis...).
- A database dump alone is useless.
- With several servers, they must **share** the key ring (`PersistKeysToFileSystem` on a shared folder, or `PersistKeysToAzureBlobStorage`...), otherwise server B can't decrypt what server A encrypted.

---

## Brute-force protection

A 6-digit code has 1,000,000 values, and with the ±1 window, 3 are valid at any moment. Unlimited tries = broken in hours. So:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("two-factor", o =>
    {
        o.PermitLimit = 5;
        o.Window = TimeSpan.FromMinutes(1);
    });
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

app.UseRateLimiter();

auth.MapPost("/login/2fa", ...).RequireRateLimiting("two-factor");
```

Plus the **per-user** lockout (`RegisterTwoFactorFailureAsync`): after 5 wrong codes, lock the account for 15 minutes. Rate limiting by IP alone isn't enough — attackers use many IPs.

---

## Otp.NET or ASP.NET Identity's built-in authenticator?

If you use **ASP.NET Core Identity**, 2FA with authenticator apps is already built in:

```csharp
var key = await userManager.GetAuthenticatorKeyAsync(user);
if (string.IsNullOrEmpty(key))
{
    await userManager.ResetAuthenticatorKeyAsync(user);      // creates the secret
    key = await userManager.GetAuthenticatorKeyAsync(user);  // base32, ready for the otpauth URI
}

bool valid = await userManager.VerifyTwoFactorTokenAsync(
    user, userManager.Options.Tokens.AuthenticatorTokenProvider, code);

var recoveryCodes = await userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
```

| | Otp.NET (this post) | Identity built-in |
|---|---|---|
| Works without Identity | ✅ (Dapper, your own users table) | ❌ |
| Control over window, replay, storage | ✅ Full | Partial |
| Recovery codes, lockout, UI templates | You write them | ✅ Included |
| Best for | Custom user stores, APIs + SPA | Apps already on Identity |

---

## Bonus: TOTP between services

TOTP isn't only for humans. In one project, background agents on many machines called a central hub, and every request carried a TOTP code in a header, computed from a shared secret — a cheap way to prove "this request comes from one of our agents", on top of TLS. A `DelegatingHandler` adds it to every outgoing request:

```csharp
public sealed class TotpHeaderHandler(ITotpCodeProvider codes, IOptions<HubClientOptions> options) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        // Only for our own hosts: never send the code to a third-party URL
        if (options.Value.TrustedHosts.Contains(request.RequestUri!.Host))
        {
            request.Headers.Remove("X-Client-Code");             // Add() appends: remove first on retries
            request.Headers.Add("X-Client-Code", codes.Current());
        }
        return base.SendAsync(request, ct);
    }
}

builder.Services.AddHttpClient<HubClient>()
    .AddHttpMessageHandler<TotpHeaderHandler>();
```

The ideas that worked well: the **trusted hosts** check, and **correcting the clock** — agents computed the code with an offset learned from the server's `Date` header, so a machine with a wrong clock still produced valid codes.

And the lessons, from my own first version:

| First version | Better |
|---|---|
| `GetKey() == code` (exact current step only) | `VerifyTotp` with a ±1 step window — no failures at step boundaries |
| `==` string comparison | `VerifyTotp` / `CryptographicOperations.FixedTimeEquals` — no timing leaks |
| One secret constant for all agents, in the code | One secret **per client**, from a vault or config — a leak affects one client, and you can revoke it |
| A code valid for its whole step, any number of times | Remember the last time step per client — no replay |
| SHA-512, 60 s step | Fine between services (both sides are your code) — keep SHA-1/30 s/6 digits only for authenticator apps |

For high-security service-to-service calls, mutual TLS or OAuth client credentials are stronger tools. But a well-implemented TOTP header is a big step up from a static API key that never changes.

---

## Key rules to remember

| Rule | Why |
|---|---|
| SHA1, 6 digits, 30 s for authenticator apps | What every app supports |
| `KeyGeneration.GenerateRandomKey(20)` + base32 | A strong secret in the expected format |
| Confirm a first code before enabling 2FA | No lockout after a failed scan |
| `VerificationWindow.RfcSpecifiedNetworkDelay` | Codes typed near the end of a step still work |
| Save the last time step, refuse older or equal | Each code is really one-time |
| Password → time-limited challenge → code → tokens | No API access with the password alone |
| Recovery codes: random, hashed, one-time, shown once | Lost phone ≠ lost account |
| Encrypt secrets with Data Protection, share the key ring | A DB dump doesn't give the secrets |
| Rate limit + per-user lockout | 1,000,000 codes is not a lot without limits |
| Between services: per-client secrets, window, replay check | TOTP done right is a cheap extra layer |

>
> ## That's it & see you soon!.
>
