---
layout: post
title: "RTK Query in depth - Cache, tags, optimistic updates and code generation"
date: 2024-11-13
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Redux', 'Javascript']
categories: ['React', 'Javascript']
description: 'RTK Query in depth - Cache, tags, optimistic updates and code generation'
image: /images/covers/rtk-query-in-depth.png
---

Replacing forty `useEffect` + `fetch` + `useState(loading)` blocks with RTK Query hooks feels great: less code, loading and error states for free, no race conditions. Then the questions start. "I created an order — why doesn't the list refresh?" "Why does it refetch every time I open the page?" "The checkbox takes half a second to toggle." All of them are about the same thing: RTK Query is a **cache**, and you get the best of it once you understand how that cache lives. We've used it already for [authentication with automatic refresh](/blog/2024/02/21/react-authentication-jwt-refresh-rtk-query); today, the features beyond basic queries.

## The core idea: a cache keyed by endpoint + arguments

```sql
useGetOrdersQuery({ status: 'paid' })   → cache key: getOrders({"status":"paid"})
useGetOrdersQuery({ status: 'paid' })   → same key → same data, ONE request (deduplicated)
useGetOrdersQuery({ status: 'new' })    → another key → another request, another cache entry
useGetOrderQuery(42)                    → getOrder(42)
```

Each cache entry counts its **subscribers** — the mounted components using it. While at least one component uses an entry, it stays. When the last one unmounts, a timer starts; when it expires, the entry is removed.

> **RTK Query doesn't "fetch data". It keeps a cache of server state in sync, and components subscribe to it.**

```js
// app/api.js
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Order', 'Customer'],
  endpoints: () => ({}),          // endpoints are injected per feature (see below)
});
```

---

## Cache lifetime

| Option | Default | Meaning |
|---|---|---|
| `keepUnusedDataFor` | 60 s | How long an entry stays after its last subscriber unmounts |
| `refetchOnMountOrArgChange` | `false` | Refetch when a component mounts even if cached data exists (`true`, or a number of seconds) |
| `refetchOnFocus` / `refetchOnReconnect` | `false` | Refetch when the window regains focus / the network comes back |

```sql
Open /orders        → fetch, cache
Go to /customers    → orders unsubscribed, 60 s timer starts
Back to /orders 20s → served from cache instantly, NO request
Back after 2 min    → entry gone → fetch again
```

That's the answer to "why doesn't it refetch?" and "why does it refetch?". Tune per endpoint:

```js
getOrders: builder.query({
  query: (filters) => ({ url: 'orders', params: filters }),
  keepUnusedDataFor: 300,              // reference-like data: keep 5 minutes
}),

// For one screen that must always show fresh data:
useGetOrdersQuery(filters, { refetchOnMountOrArgChange: 30 });   // refetch if older than 30 s
```

---

## Tags: automatic refetching after changes

Mutations don't know which queries they affect — **tags** tell them. A query **provides** tags; a mutation **invalidates** tags; every cached query providing an invalidated tag is refetched (if it has subscribers) or marked stale.

### The LIST + id pattern

```js
// features/orders/ordersApi.js
import { api } from '../../app/api';

export const ordersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getOrders: builder.query({
      query: (filters) => ({ url: 'orders', params: filters }),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'Order', id })), { type: 'Order', id: 'LIST' }]
          : [{ type: 'Order', id: 'LIST' }],
    }),
    getOrder: builder.query({
      query: (id) => `orders/${id}`,
      providesTags: (result, error, id) => [{ type: 'Order', id }],
    }),
    createOrder: builder.mutation({
      query: (body) => ({ url: 'orders', method: 'POST', body }),
      invalidatesTags: [{ type: 'Order', id: 'LIST' }],                 // lists change
    }),
    updateOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `orders/${id}`, method: 'PUT', body }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Order', id }],   // this order, everywhere
    }),
    deleteOrder: builder.mutation({
      query: (id) => ({ url: `orders/${id}`, method: 'DELETE' }),
      invalidatesTags: (result, error, id) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }],
    }),
  }),
});

export const { useGetOrdersQuery, useGetOrderQuery, useCreateOrderMutation,
               useUpdateOrderMutation, useDeleteOrderMutation } = ordersApi;
```

| Mutation | Invalidates | Refetched |
|---|---|---|
| Create | `Order:LIST` | Every orders list (all filters) |
| Update order 42 | `Order:42` | `getOrder(42)` **and** every list containing order 42 |
| Delete order 42 | `Order:42`, `Order:LIST` | All of the above |

Every list provides `LIST` plus one tag per order it contains — so updating one order refreshes exactly the queries that show it, and creating one refreshes the lists, where it might appear.

---

## Pessimistic vs optimistic updates

Tags give **pessimistic** updates: the UI changes after the server confirms (mutation → invalidate → refetch). Safe, but you wait for two round trips. For small, frequent actions (a checkbox, a star, reordering), update the cache **immediately** and roll back if the server fails — an **optimistic** update:

```js
toggleFavorite: builder.mutation({
  query: ({ id, favorite }) => ({ url: `orders/${id}/favorite`, method: 'PUT', body: { favorite } }),
  async onQueryStarted({ id, favorite, filters }, { dispatch, queryFulfilled }) {
    // 1. Patch the cached list right away
    const patch = dispatch(
      ordersApi.util.updateQueryData('getOrders', filters, (draft) => {
        const order = draft.find((o) => o.id === id);
        if (order) order.favorite = favorite;
      })
    );
    try {
      await queryFulfilled;          // 2. Server confirmed: nothing to do
    } catch {
      patch.undo();                  // 3. Server failed: put the old value back
    }
  },
}),
```

```sql
Click ★ → star shows instantly (cache patched) → PUT in the background
        → OK:    done, no refetch needed
        → error: star goes back, show a toast
```

`updateQueryData` takes the **endpoint name and the exact arguments** of the cached entry, and an Immer "draft" you can mutate. Use optimistic updates when failures are rare and easy to undo; keep pessimistic updates for things like payments, where showing success before the server agrees would be wrong.

---

## Shaping responses and errors

```js
getOrders: builder.query({
  query: (filters) => ({ url: 'orders', params: filters }),
  transformResponse: (response) => response.items.map((o) => ({ ...o, orderDate: new Date(o.orderDate) })),
  transformErrorResponse: (response) => ({
    status: response.status,
    message: response.data?.detail ?? response.data?.title ?? 'Unexpected error',   // ProblemDetails
    errors: response.data?.errors ?? {},
  }),
}),
```

With an API that always returns **ProblemDetails** (like the one from the [global error handling post](/blog/2024/05/08/aspnet-core-global-error-handling-iexceptionhandler)), one small `transformErrorResponse` gives every component the same error shape. (Keep in mind dates turned into `Date` objects aren't serializable in the Redux store — RTK warns about it in development. Often it's simpler to keep ISO strings and format them when displaying.)

---

## Conditional and lazy queries

```js
import { skipToken } from '@reduxjs/toolkit/query/react';

// Don't fetch until we have an id (e.g. from the URL or a selection)
const { data: order } = useGetOrderQuery(selectedId ?? skipToken);

// Fetch on demand: a "Load details" button, a search launched by the user
const [loadInvoice, { data: invoice, isFetching }] = useLazyGetInvoiceQuery();
<button onClick={() => loadInvoice(order.id)}>Show invoice</button>
```

`skipToken` (or `{ skip: true }`) is the clean replacement for "if (!id) return" inside a `useEffect`. Lazy queries give you a trigger function — the result is still cached like any query.

---

## Polling, focus and reconnect

```js
// A dashboard that refreshes every 30 seconds while it's on screen
const { data: stats } = useGetStatsQuery(undefined, { pollingInterval: 30_000 });
```

```js
// app/store.js — needed for refetchOnFocus / refetchOnReconnect to work
import { setupListeners } from '@reduxjs/toolkit/query';
setupListeners(store.dispatch);
```

```js
// Per endpoint or per hook: refresh when the user comes back to the tab
useGetOrdersQuery(filters, { refetchOnFocus: true });
```

Polling stops automatically when the component unmounts. For data that changes often and must appear instantly, polling is a fine first step; a push channel (WebSockets / SignalR) is the step after.

---

## Prefetching on hover

Load the details **before** the click:

```jsx
function OrderLink({ id, children }) {
  const prefetchOrder = ordersApi.usePrefetch('getOrder');
  return (
    <Link to={`/orders/${id}`} onMouseEnter={() => prefetchOrder(id, { ifOlderThan: 60 })}>
      {children}
    </Link>
  );
}
```

By the time the user clicks, `getOrder(id)` is often already in the cache — the details page opens instantly.

---

## Splitting the API by feature

One `createApi` per backend, but not one giant file: each feature **injects** its endpoints, as above (`api.injectEndpoints(...)`). The base `api` holds the base query (with auth and re-authentication), tag types and global options; `features/orders/ordersApi.js`, `features/customers/customersApi.js`... hold their endpoints. Lazy-loaded routes (with `React.lazy`) only load their endpoints when needed.

### Generating endpoints from OpenAPI

If the ASP.NET Core API publishes an OpenAPI document (Swagger), `@rtk-query/codegen-openapi` can generate the endpoints and hooks from it:

```js
// openapi-config.cjs
module.exports = {
  schemaFile: 'https://localhost:7001/swagger/v1/swagger.json',
  apiFile: './src/app/api.js',
  apiImport: 'api',
  outputFile: './src/app/generatedApi.ts',
  exportName: 'shopApi',
  hooks: true,
};
```

```sql
npx @rtk-query/codegen-openapi openapi-config.cjs
```

The generator writes a TypeScript file. Endpoints, parameters and hooks stay in sync with the server — rename a route in C#, regenerate, and the build tells you what broke. Tags are then added with `enhanceEndpoints`. Whether it's worth it depends on the size of the API: for a few endpoints, hand-written is simpler.

---

## Key rules to remember

| Rule | Why |
|---|---|
| RTK Query is a cache keyed by endpoint + arguments | Same args = same data, deduplicated requests |
| Entries live while subscribed + `keepUnusedDataFor` (60 s) | Explains "why no request" and "why a request" |
| `refetchOnMountOrArgChange` for screens that must be fresh | Per screen, not globally |
| Lists provide `LIST` + one tag per item | Precise invalidation for create, update, delete |
| Mutations invalidate what they change | Queries refresh themselves |
| Optimistic updates with `updateQueryData` + `undo` | Instant UI for frequent, low-risk actions |
| `transformErrorResponse` for one error shape (ProblemDetails) | Components handle errors the same way |
| `skipToken` and lazy queries instead of effects | Conditional fetching without `useEffect` |
| `setupListeners` for focus/reconnect, `pollingInterval` for dashboards | Fresh data without manual timers |
| `usePrefetch` on hover, `injectEndpoints` per feature | Instant navigation, organized code |

>
> ## That's it & see you soon!.
>
