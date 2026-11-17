---
layout: post
title: "Real-time with SignalR and React - Hubs, hooks and reconnection"
date: 2025-10-08
author: Malekbenz
comments: true
category: Asp.Net
tags : [ '.Net', 'Asp.Net', 'SignalR', 'React', 'Redux']
categories: ['SignalR', 'Asp.Net']
description: 'Real-time with SignalR and React - Hubs, hooks and reconnection'
image: /images/covers/realtime-signalr-react-hooks.png
---

Users keep pressing F5 to see if a new order arrived. The dashboard polls the API every 2 seconds, and 90% of the answers are "nothing changed". Back in 2017 I wrote a [small slide application with SignalR](/blog/2017/03/10/Create-simple-Slide-application-with-Singalr). A lot changed since then: ASP.NET Core, a new JavaScript client, React hooks, RTK Query. Let's build real-time updates the modern way — and handle the parts that tutorials usually skip: authentication, reconnection and missed messages.

## How SignalR works

SignalR keeps a **persistent connection** between the browser and the server, so the server can **push** messages when something happens.

```sql
1. Client → POST /hubs/orders/negotiate   "Which transports do you support?"
2. Server → "WebSockets, ServerSentEvents, LongPolling"
3. Client opens the best one it can: WebSockets (almost always today)
4. Both sides can now call each other's methods by name
```

| Transport | Direction | When it's used |
|---|---|---|
| WebSockets | Full duplex, one TCP connection | Default — every modern browser |
| Server-Sent Events | Server → client (client sends with HTTP) | WebSockets blocked by a proxy |
| Long Polling | Repeated HTTP requests | Last fallback |

You don't choose — SignalR negotiates. But you must know it, because a proxy or load balancer that blocks WebSockets silently downgrades you to long polling.

> **SignalR doesn't replace your API. The API still loads and saves data. SignalR just tells the clients "something changed".**

---

## The hub in ASP.NET Core

### Strongly typed hubs

With a normal `Hub`, the client method name is a string — a typo compiles fine and nothing happens at runtime. A **strongly typed hub** fixes that:

```csharp
public interface IOrdersClient
{
    Task OrderCreated(OrderDto order);
    Task OrderUpdated(OrderDto order);
}

[Authorize]
public sealed class OrdersHub : Hub<IOrdersClient>
{
    public override async Task OnConnectedAsync()
    {
        // Every agent of a store joins the store's group
        var storeId = Context.User?.FindFirst("store_id")?.Value;
        if (storeId is not null)
            await Groups.AddToGroupAsync(Context.ConnectionId, $"store:{storeId}");

        await base.OnConnectedAsync();
    }
}
```

```csharp
builder.Services.AddSignalR();

app.MapHub<OrdersHub>("/hubs/orders", o => o.AllowStatefulReconnects = true);
```

(`AllowStatefulReconnects` is explained below, in the reconnection part.)

Hubs are **transient**: a new instance for each call. Never keep state in hub fields — use a database, a cache, or groups.

### Groups & JWT auth

The JavaScript client can't set an `Authorization` header on a WebSocket. So it sends the token in the **query string** (`?access_token=...`), and the server must read it from there:

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // ... Issuer, Audience, Key from configuration (see the configuration post)

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) &&
                    context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            }
        };
    });
```

Only for paths under `/hubs`, so your normal API keeps using the header. And since the token is in the URL, make sure your logs don't record query strings for these paths.

Three ways to target clients:

| Target | Code | Use for |
|---|---|---|
| Everybody | `Clients.All` | Global announcements |
| A group | `Clients.Group("store:42")` | A store, a room, a project |
| A user (all their tabs/devices) | `Clients.User(userId)` | Personal notifications (uses the `NameIdentifier` claim) |

### Sending from outside the hub

Most messages don't come from the hub, but from your **API**, after a save. Inject `IHubContext`:

```csharp
app.MapPost("/api/orders", async (
        CreateOrderRequest request,
        OrderRepository repo,
        IHubContext<OrdersHub, IOrdersClient> hub) =>
{
    var order = await repo.CreateAsync(request);

    await hub.Clients.Group($"store:{order.StoreId}").OrderCreated(order);

    return Results.Created($"/api/orders/{order.Id}", order);
})
.RequireAuthorization();
```

Same for the update endpoint from the [rowversion post](/blog/2025/06/11/sqlserver-optimistic-concurrency-rowversion-dapper): after a successful update, send `OrderUpdated` — the other agents see the change **before** they even try to save.

---

## The React side

```sql
npm install @microsoft/signalr
```

### One connection for the whole app

The classic mistake is to create a connection **inside a component**. Every mount opens a new connection, and in development React StrictMode mounts twice — you get this famous error:

```sql
Error: Failed to start the HubConnection before stop() was called.
```

Create **one** connection, outside React, and share it:

```js
// realtime/connection.js
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { getAccessToken } from '../auth/tokens';

export const connection = new HubConnectionBuilder()
  .withUrl('/hubs/orders', { accessTokenFactory: () => getAccessToken() })
  .withAutomaticReconnect([0, 2000, 10000, 30000])   // retry delays in ms
  .withStatefulReconnect()
  .configureLogging(LogLevel.Warning)
  .build();

let starting = null;

export function ensureStarted() {
  if (connection.state === 'Disconnected') {
    starting = connection.start().catch((err) => {
      starting = null;
      throw err;
    });
  }
  return starting ?? Promise.resolve();
}
```

`accessTokenFactory` is called on every connect and reconnect, so a refreshed token is always used.

### A useSignalR hook

Components only need to say "call me when this event arrives":

```js
// realtime/useHubEvent.js
import { useEffect, useRef } from 'react';
import { connection, ensureStarted } from './connection';

export function useHubEvent(eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;            // always the latest handler, no re-subscribe

  useEffect(() => {
    const listener = (...args) => handlerRef.current(...args);

    connection.on(eventName, listener);
    ensureStarted().catch((err) => console.error('SignalR start failed', err));

    return () => connection.off(eventName, listener);   // cleanup: no duplicate listeners
  }, [eventName]);
}
```

```jsx
function NewOrderToast() {
  const [last, setLast] = useState(null);

  useHubEvent('OrderCreated', (order) => setLast(order));

  return last ? <div className="toast">New order #{last.id} — total {last.total}</div> : null;
}
```

Why the `useRef`? If we passed `handler` in the dependency array, the effect would run on **every render** (a new arrow function each time): `off`, `on`, `off`, `on`... With the ref, we subscribe once and still call the latest handler.

And `connection.off(eventName, listener)` with the **same** function is essential: without it, every StrictMode double-mount or navigation adds one more listener, and each message is handled 2, 3, 4 times.

### Showing the connection state

```js
export function useConnectionState() {
  const [state, setState] = useState(connection.state);

  useEffect(() => {
    connection.onreconnecting(() => setState('Reconnecting'));
    connection.onreconnected(() => setState('Connected'));
    connection.onclose(() => setState('Disconnected'));
  }, []);

  return state;
}
```

A small "Reconnecting…" badge saves a lot of support calls: users know the screen is not live right now.

---

## Reconnection & missed messages

Networks drop: Wi-Fi changes, a laptop sleeps, the server restarts during a deployment. Three levels of protection:

```sql
Short blip (a few seconds)   → stateful reconnect: buffered messages are replayed       ✅
Longer outage                 → automatic reconnect, but messages sent meanwhile are LOST ⚠️
All retries failed            → onclose: the connection stays down until you restart it  ❌
```

**1. Stateful reconnect** (since .NET 8): `withStatefulReconnect()` on the client + `AllowStatefulReconnects = true` on the server. Both sides buffer messages for a short disconnect and replay them after reconnecting. It covers the small blips.

**2. Refetch after a reconnect.** For longer outages, assume you missed something and reload the data:

```js
connection.onreconnected(() => {
  store.dispatch(ordersApi.util.invalidateTags([{ type: 'Order', id: 'LIST' }]));
});
```

Also note: after a reconnect, the client gets a **new connection id**. Groups are per connection — that's why we join them in `OnConnectedAsync` on the server: it runs again on every reconnect, so the client is back in its groups automatically.

**3. Restart after a full close.** `withAutomaticReconnect` gives up after the last delay. Restart it yourself:

```js
connection.onclose(() => {
  setTimeout(() => ensureStarted().catch(() => {}), 30000);
});
```

---

## Pushing events into the RTK Query cache

Instead of keeping SignalR data in component state, put it **where your data already lives**: the RTK Query cache. RTK Query has a hook point for exactly this, `onCacheEntryAdded`:

```js
// features/orders/ordersApi.js
import { connection, ensureStarted } from '../../realtime/connection';

export const ordersApi = createApi({
  reducerPath: 'ordersApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Order'],
  endpoints: (builder) => ({
    getOrders: builder.query({
      query: () => 'orders',
      providesTags: [{ type: 'Order', id: 'LIST' }],

      async onCacheEntryAdded(arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        const onCreated = (order) =>
          updateCachedData((draft) => { draft.unshift(order); });

        const onUpdated = (order) =>
          updateCachedData((draft) => {
            const i = draft.findIndex((o) => o.id === order.id);
            if (i !== -1) draft[i] = order;
          });

        try {
          await cacheDataLoaded;             // wait for the first HTTP load
          await ensureStarted();
          connection.on('OrderCreated', onCreated);
          connection.on('OrderUpdated', onUpdated);
        } catch {
          // the cache entry was removed before the data loaded
        }

        await cacheEntryRemoved;             // no component uses this list anymore
        connection.off('OrderCreated', onCreated);
        connection.off('OrderUpdated', onUpdated);
      },
    }),
  }),
});
```

Now any component using `useGetOrdersQuery()` is live — no extra hook, no extra state:

```sql
1. useGetOrdersQuery() → HTTP GET /api/orders → list in cache
2. Another agent creates an order → API saves → hub sends OrderCreated
3. onCreated → updateCachedData → every component showing the list re-renders
4. Last component unmounts → cacheEntryRemoved → listeners removed
```

`updateCachedData` uses Immer, so you write "mutating" code (`unshift`, `draft[i] = ...`) and it produces a new immutable state.

---

## Scaling out

One server keeps its connections in memory. With **two** servers behind a load balancer, a message sent on server A never reaches clients connected to server B.

| Option | How it works | Sticky sessions? | Think about it when |
|---|---|---|---|
| Single server | Connections in memory | No | Internal apps, one instance |
| Redis backplane | Servers publish messages to each other through Redis | **Yes** (unless WebSockets only) | On-premises, you already have Redis |
| Azure SignalR Service | Clients connect to Azure, your servers only send | No | Hosted on Azure, many connections |

For Redis it's one line (package `Microsoft.AspNetCore.SignalR.StackExchangeRedis`):

```csharp
builder.Services.AddSignalR().AddStackExchangeRedis(builder.Configuration.GetConnectionString("Redis")!);
```

Sticky sessions are needed because the negotiate request and the connection itself must reach the **same** server.

---

## Key rules to remember

| Rule | Why |
|---|---|
| SignalR notifies, the API loads and saves | Clear responsibilities, easy recovery |
| Use strongly typed hubs (`Hub<IClient>`) | Typos in method names become compile errors |
| Read the JWT from `access_token` for `/hubs` paths | WebSockets can't send the header |
| Send from your endpoints with `IHubContext` | Notify right after a successful save |
| One connection per app, created outside React | No StrictMode errors, no duplicate connections |
| Always `off` the same listener in the cleanup | Otherwise messages are handled several times |
| Stateful reconnect + refetch after `onreconnected` | Short blips replayed, long outages recovered |
| Join groups in `OnConnectedAsync` | A reconnect gets a new connection id |
| Push events into the RTK Query cache | One source of truth, every view stays live |
| More than one server = backplane or Azure SignalR | Otherwise messages stay on one server |

>
> ## That's it & see you soon!.
>
