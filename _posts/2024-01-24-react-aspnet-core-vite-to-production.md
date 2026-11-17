---
layout: post
title: "React + ASP.NET Core - From the Vite dev server to one production deployment"
date: 2024-01-24
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'React', 'Asp.Net', '.Net', 'Javascript']
categories: ['Asp.Net', 'React']
description: 'React + ASP.NET Core - From the Vite dev server to one production deployment'
image: /images/covers/react-aspnet-core-vite-to-production.png
---

Everything works on `localhost:5173`. Then you deploy: the API calls fail with **CORS errors**, a hard-coded `https://localhost:7001` sneaked into the bundle, and when a user presses **F5** on `/orders/42`, the server answers **404**. These are the three classic problems of a React front-end with an ASP.NET Core back-end. Let's set it up properly, from the development server to a single production deployment — the setup I use in real projects.

## The core idea: two servers in dev, one origin in prod

```sql
Development                                   Production
───────────                                   ──────────
Browser → Vite dev server :5173               Browser → https://app.example.com
            │  (hot reload, React)                         │
            └─ /api/* ──proxy──► API :7001                 ├─ /           → React build (static files)
                                                           ├─ /assets/*   → JS/CSS (static files)
                                                           └─ /api/*      → ASP.NET Core endpoints
```

The goal: in **both** cases, the browser only talks to **one origin**. The React code calls `/api/orders` — a relative URL — and never needs to know where the API really is.

> **If your front-end and API share one origin, you don't need CORS at all.** CORS is a solution for a problem you can usually avoid.

---

## Project layout

```sql
MyApp/
├── api/                      ← ASP.NET Core (.NET 8)
│   ├── MyApp.Api.csproj
│   ├── Program.cs
│   └── wwwroot/              ← the React build goes here (not in Git)
└── web/                      ← React + Vite
    ├── package.json
    ├── vite.config.js
    └── src/
```

Two independent projects: `npm` tools in `web/`, `dotnet` tools in `api/`. Each team member can run only the part they work on.

(Visual Studio 2022's "React and ASP.NET Core" template creates almost the same structure, with a `SpaProxy` package that starts Vite for you. What follows works with or without it.)

---

## Dev: the Vite proxy (no CORS)

```js
// web/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://localhost:7001',
        changeOrigin: true,
        secure: false,          // accept the ASP.NET Core development certificate
      },
      '/hubs': {
        target: 'https://localhost:7001',
        changeOrigin: true,
        secure: false,
        ws: true,               // WebSockets for SignalR
      },
    },
  },
  build: {
    outDir: '../api/wwwroot',
    emptyOutDir: true,
  },
});
```

For the browser, everything comes from `localhost:5173`. Vite forwards `/api/*` and `/hubs/*` to Kestrel **server-side**, so there's no cross-origin request and no CORS configuration.

In the React code, always use relative URLs:

```js
// ✅ Works in dev (through the proxy) and in prod (same origin)
const response = await fetch('/api/orders');

// ❌ Works only on your machine
const response = await fetch('https://localhost:7001/api/orders');
```

Run both:

```sql
cd api && dotnet watch     # API on https://localhost:7001
cd web && npm run dev      # React on http://localhost:5173
```

---

## Prod option 1: ASP.NET Core serves the build

`npm run build` writes the optimized files into `api/wwwroot` (thanks to `outDir`):

```sql
wwwroot/
├── index.html
└── assets/
    ├── index-3f8a1c2b.js      ← the hash changes when the content changes
    └── index-9d0e44a1.css
```

### UseStaticFiles + MapFallbackToFile (the F5 / 404 fix)

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();

var app = builder.Build();

app.UseDefaultFiles();          // "/" → index.html
app.UseStaticFiles();           // serves wwwroot/*

app.MapControllers();           // /api/... endpoints

// Unknown /api routes must stay 404 — not return the React page
app.MapFallback("/api/{**path}", () => Results.NotFound());

// Any other unknown route → index.html, React Router takes over
app.MapFallbackToFile("index.html");

app.Run();
```

Why the fallback? With React Router, `/orders/42` exists **only in the browser**. When the user refreshes the page, the browser asks the server for `/orders/42`, and there's no such file:

```sql
Without fallback:  GET /orders/42 → 404 ❌
With fallback:     GET /orders/42 → index.html → React Router shows order 42 ✅
```

And the `/api/{**path}` fallback protects you from a confusing bug: a typo in an API URL would otherwise return `200` with the HTML of `index.html`, and your `response.json()` would fail with *"Unexpected token <"*.

### Caching: hashed assets vs index.html

The files in `/assets/` have a **hash in their name**: a new build = new names. They can be cached forever. `index.html` has a fixed name: it must **never** be cached, or users keep loading the old version after a deployment.

```csharp
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var headers = ctx.Context.Response.Headers;

        headers.CacheControl = ctx.File.Name == "index.html"
            ? "no-cache"                                   // always check for a new version
            : "public, max-age=31536000, immutable";       // hashed files: cache 1 year
    }
});

app.MapFallbackToFile("index.html", new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});
```

| File | Cache-Control | Why |
|---|---|---|
| `index.html` | `no-cache` | Points to the current hashed files — must always be fresh |
| `/assets/*-[hash].js/css` | `max-age=31536000, immutable` | A new build creates new names |

---

## Prod option 2: a YARP gateway in front of several APIs

When the app grows into several back-ends (catalog, billing, identity...), you still want **one origin** for the browser. Put a small gateway in front with **YARP** (Yet Another Reverse Proxy, from Microsoft):

```sql
Browser → https://app.example.com  (Gateway: YARP + React build)
            ├─ /                 → React static files
            ├─ /api/catalog/*    → catalog-api   (http://catalog:8080)
            ├─ /api/billing/*    → billing-api   (http://billing:8080)
            └─ /hubs/*           → notifications (WebSockets)
```

```csharp
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapReverseProxy();
app.MapFallbackToFile("index.html");
app.Run();
```

```json
{
  "ReverseProxy": {
    "Routes": {
      "catalog": {
        "ClusterId": "catalog",
        "Match": { "Path": "/api/catalog/{**rest}" },
        "Transforms": [ { "PathRemovePrefix": "/api/catalog" } ]
      },
      "billing": {
        "ClusterId": "billing",
        "Match": { "Path": "/api/billing/{**rest}" },
        "Transforms": [ { "PathRemovePrefix": "/api/billing" } ]
      }
    },
    "Clusters": {
      "catalog": { "Destinations": { "d1": { "Address": "http://catalog:8080/" } } },
      "billing": { "Destinations": { "d1": { "Address": "http://billing:8080/" } } }
    }
  }
}
```

The back-end APIs are not exposed to the internet anymore, and the gateway is the one place for TLS, authentication cookies, rate limiting or request logging. YARP is configuration-driven, so adding an API is a JSON change — and it supports WebSockets out of the box.

---

## Environment config: VITE_ vs runtime

With relative URLs, most apps need **no** front-end configuration at all. When you do need some (a feature flag, the name of the environment shown in the header), remember:

```sql
VITE_* variables   → replaced at BUILD time → written in the JS bundle → one build per environment
/config.json        → read at RUN time from the server → one build for all environments
```

```csharp
app.MapGet("/config.json", (IConfiguration config) => Results.Ok(new
{
    environment = app.Environment.EnvironmentName,
    supportEmail = config["Client:SupportEmail"],
}));
```

And never put a secret in either: everything sent to the browser is public.

---

## One build pipeline: npm build → wwwroot → dotnet publish

Let `dotnet publish` build the front-end too, so CI has only one command:

```xml
<!-- api/MyApp.Api.csproj -->
<Target Name="BuildClient" BeforeTargets="Publish">
  <Exec WorkingDirectory="../web" Command="npm ci" />
  <Exec WorkingDirectory="../web" Command="npm run build" />
</Target>
```

```sql
dotnet publish api -c Release -o out
→ npm ci, npm run build (into api/wwwroot), then the .NET publish
→ out/ contains the API AND the React files: one folder, one deployment
```

Add `wwwroot/` to `.gitignore` in the `api` project — it's a build output, like `bin/`.

With Docker, the same idea in a multi-stage build:

```dockerfile
FROM node:20 AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build -- --outDir /out/wwwroot

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS api
WORKDIR /src
COPY api/ ./api/
RUN dotnet publish api -c Release -o /out/app -p:SkipClientBuild=true

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=api /out/app ./
COPY --from=web /out/wwwroot ./wwwroot
ENTRYPOINT ["dotnet", "MyApp.Api.dll"]
```

(For the Docker build, add `Condition="'$(SkipClientBuild)' != 'true'"` on the `BuildClient` target, since Node isn't in the .NET SDK image.)

---

## Key rules to remember

| Rule | Why |
|---|---|
| One origin for the browser, in dev and in prod | No CORS to configure |
| Always relative URLs (`/api/...`) in React | No localhost in the bundle |
| Vite `server.proxy` in dev (`ws: true` for SignalR) | The browser only sees the Vite server |
| `MapFallbackToFile("index.html")` | F5 on a React Router route works |
| A 404 fallback for `/api/{**path}` | API typos don't return HTML |
| `index.html` no-cache, hashed assets immutable | Users always get the latest deployment |
| Several APIs → a YARP gateway | Still one origin, APIs not exposed |
| No secrets in `VITE_` variables or `/config.json` | Everything in the browser is public |
| Build the front-end from `dotnet publish` | One command, one artifact |

>
> ## That's it & see you soon!.
>
