---
layout: post
title: "Authentication in React - JWT, protected routes and automatic token refresh"
date: 2024-02-21
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Redux', 'Javascript', 'Security']
categories: ['React', 'Javascript']
description: 'Authentication in React - JWT, protected routes and automatic token refresh'
image: /images/covers/react-authentication-jwt-refresh-rtk-query.png
---

Two classic versions of React authentication. In the first one, the access token expires after 15 minutes and the user is thrown back to the login page in the middle of a form. In the second one — I've written it too — the token goes into `localStorage.setItem('token', ...)` with a long lifetime, so nobody is ever logged out... including an attacker who managed to run one line of JavaScript on the page. In the [previous post](/blog/2024/02/07/aspnet-core-jwt-refresh-tokens-dotnet-8) we built an ASP.NET Core API with short access tokens and rotating refresh tokens. Today, the React side: where to keep the tokens, how to refresh them **automatically** with RTK Query, and how to protect routes with React Router.

## The core idea: access token in memory, refresh token in a cookie

```sql
                    ┌───────────────── Browser ─────────────────┐
Access token  (JWT) │ Redux store (memory)                       │ ← lost on F5, that's OK
                    │   sent as  Authorization: Bearer ...       │
Refresh token       │ HttpOnly cookie (path=/auth)               │ ← JavaScript can't read it
                    │   sent automatically to /auth/* only       │
                    └────────────────────────────────────────────┘
```

| Where | XSS can steal it? | Survives F5? | Use for |
|---|---|---|---|
| Memory (Redux state) | Only while the page is open | ❌ | The short-lived **access** token |
| `HttpOnly` cookie | ❌ No | ✅ | The **refresh** token |
| `localStorage` | ✅ Yes, any script can read it | ✅ | UI preferences (sidebar open, sort order) — not tokens |

When the page reloads, the access token is gone — no problem: we ask `/auth/refresh` for a new one, and the browser sends the cookie by itself. The user doesn't notice anything.

> **The rule: a token that JavaScript can read, an XSS attack can read too. Keep the long-lived one where JavaScript can't reach.**

---

## An auth slice with Redux Toolkit

```js
// features/auth/authSlice.js
import { createSlice } from '@reduxjs/toolkit';
import { jwtDecode } from 'jwt-decode';

const initialState = {
  accessToken: null,
  user: null,              // { id, name, roles } — decoded from the token, for the UI only
  status: 'checking',      // 'checking' | 'authenticated' | 'anonymous'
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    tokenReceived(state, action) {
      const { accessToken } = action.payload;
      const claims = jwtDecode(accessToken);

      state.accessToken = accessToken;
      state.user = {
        id: claims.sub,
        name: claims.unique_name,
        roles: [].concat(claims.role ?? []),   // one role = string, several = array
      };
      state.status = 'authenticated';
    },
    loggedOut() {
      return { ...initialState, status: 'anonymous' };
    },
  },
});

export const { tokenReceived, loggedOut } = authSlice.actions;
export default authSlice.reducer;

export const selectAuth = (state) => state.auth;
```

Two details:

- **`jwt-decode` v4** uses a named import: `import { jwtDecode } from 'jwt-decode'`. The old default import (`import jwt_decode from ...`) was removed — a classic error after an `npm update`.
- **`roles: [].concat(...)`**: when a user has one role, the claim is a string; with several, an array. Normalizing it once avoids `user.roles.includes is not a function` later.

---

## Login with RTK Query

```js
// app/api.js
import { createApi } from '@reduxjs/toolkit/query/react';
import { baseQueryWithReauth } from './baseQuery';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Order', 'Customer'],
  endpoints: () => ({}),
});
```

```js
// features/auth/authApi.js
import { api } from '../../app/api';
import { tokenReceived, loggedOut } from './authSlice';

export const authApi = api.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation({
      query: (credentials) => ({ url: '/auth/login', method: 'POST', body: credentials }),
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(tokenReceived(data));
      },
    }),
    logout: builder.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        try { await queryFulfilled; } finally {
          dispatch(loggedOut());
          dispatch(api.util.resetApiState());   // forget all cached data of the previous user
        }
      },
    }),
  }),
});

export const { useLoginMutation, useLogoutMutation } = authApi;
```

`api.util.resetApiState()` on logout is easy to forget: without it, the next person logging in on the same browser can briefly see the **previous user's** cached orders.

---

## prepareHeaders: add the Bearer token

```js
// app/baseQuery.js
import { fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/',
  credentials: 'include',            // send the refresh cookie to /auth/*
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});
```

The token comes from the **Redux state**, not from `localStorage`. And because `prepareHeaders` runs for every request, a refreshed token is used immediately by the next call.

---

## baseQueryWithReauth: 401 → refresh once → retry

The heart of the post. When a request fails with **401**, we refresh the token and retry the request — once, transparently:

```js
// app/baseQuery.js (continued)
import { Mutex } from 'async-mutex';
import { tokenReceived, loggedOut } from '../features/auth/authSlice';

const mutex = new Mutex();

export const baseQueryWithReauth = async (args, api, extraOptions) => {
  await mutex.waitForUnlock();                       // a refresh is running? wait for it
  let result = await rawBaseQuery(args, api, extraOptions);

  const isAuthCall = typeof args !== 'string' && args.url?.startsWith('/auth/');

  if (result.error?.status === 401 && !isAuthCall) {
    if (!mutex.isLocked()) {
      const release = await mutex.acquire();
      try {
        const refresh = await rawBaseQuery({ url: '/auth/refresh', method: 'POST' }, api, extraOptions);

        if (refresh.data) {
          api.dispatch(tokenReceived(refresh.data));
          result = await rawBaseQuery(args, api, extraOptions);    // retry with the new token
        } else {
          api.dispatch(loggedOut());                               // refresh token expired or revoked
        }
      } finally {
        release();
      }
    } else {
      await mutex.waitForUnlock();                   // another request refreshed for us
      result = await rawBaseQuery(args, api, extraOptions);
    }
  }

  return result;
};
```

```sql
npm install async-mutex
```

Why the **mutex**? A dashboard loads 6 widgets at the same time, and the token just expired:

```sql
Without mutex: 6 requests → 6 × 401 → 6 × /auth/refresh
               → refresh #1 rotates the token, refreshes #2..#6 use the OLD one
               → the server sees a reused refresh token → revokes the whole session ❌ logged out!

With mutex:    6 × 401 → ONE /auth/refresh → the 5 others wait → all 6 retried ✅
```

With **rotating** refresh tokens (each one usable once), parallel refreshes are not just wasteful — they look exactly like a stolen token. The mutex is mandatory.

And `isAuthCall`: a 401 from `/auth/login` (wrong password) or `/auth/refresh` itself must **not** trigger a refresh, or you loop.

---

## Restoring the session on page load

After F5, the store is empty: `status: 'checking'`. Before showing any protected page, try a silent refresh:

```jsx
// app/AuthBootstrap.jsx
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectAuth, tokenReceived, loggedOut } from '../features/auth/authSlice';

export function AuthBootstrap({ children }) {
  const dispatch = useDispatch();
  const { status } = useSelector(selectAuth);

  useEffect(() => {
    fetch('/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => dispatch(tokenReceived(data)))
      .catch(() => dispatch(loggedOut()));
  }, [dispatch]);

  if (status === 'checking') return <div className="splash">Loading…</div>;
  return children;
}
```

```jsx
// main.jsx
createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <AuthBootstrap>
      <RouterProvider router={router} />
    </AuthBootstrap>
  </Provider>
);
```

Without the `'checking'` state, the app would decide "not logged in" during the first milliseconds and **redirect to /login** before the refresh even answers.

> In development, React 18 StrictMode runs effects twice — that would send two refreshes, and with rotation the second one uses an already-used token. Guard it with a `useRef` flag, or do the bootstrap outside React, before `createRoot(...).render`.

---

## Protected routes with React Router 6

{% raw %}
```jsx
// app/RequireAuth.jsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectAuth } from '../features/auth/authSlice';

export function RequireAuth({ roles }) {
  const { status, user } = useSelector(selectAuth);
  const location = useLocation();

  if (status !== 'authenticated')
    return <Navigate to="/login" replace state={{ from: location }} />;

  if (roles && !roles.some((r) => user.roles.includes(r)))
    return <Navigate to="/forbidden" replace />;

  return <Outlet />;
}
```
{% endraw %}

```jsx
// app/router.jsx
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,                       // everything below needs a login
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/orders', element: <OrdersPage /> },
      {
        element: <RequireAuth roles={['Admin']} />, // and this needs the Admin role
        children: [{ path: '/admin/users', element: <UsersAdmin /> }],
      },
    ],
  },
]);
```

After login, send the user back where they wanted to go:

```jsx
function LoginPage() {
  const [login, { isLoading, error }] = useLoginMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname ?? '/';

  const onSubmit = async (form) => {
    await login(form).unwrap();
    navigate(from, { replace: true });
  };
  // ...
}
```

---

## Reading claims with jwt-decode: UI only

```jsx
const { user } = useSelector(selectAuth);

{user.roles.includes('Admin') && <Link to="/admin/users">Users</Link>}
```

Hiding a menu item is **comfort, not security**. Anyone can edit the JavaScript in the browser and show the button. The real check is on the server: `[Authorize(Roles = "Admin")]` or `RequireAuthorization(...)` on every endpoint. `jwtDecode` doesn't even verify the signature — it just reads the payload.

---

## Logout everywhere

```jsx
function UserMenu() {
  const [logout] = useLogoutMutation();
  return <button onClick={() => logout()}>Log out</button>;
}
```

What happens:

```sql
1. POST /auth/logout   → the server revokes the refresh token (and clears the cookie)
2. loggedOut()         → access token removed from memory
3. resetApiState()     → cached data of this user removed
4. RequireAuth         → status is 'anonymous' → redirect to /login
```

For other open **tabs**, a `BroadcastChannel('auth')` message lets them log out too — otherwise they keep a valid access token until it expires (15 minutes at most, by design).

---

## Key rules to remember

| Rule | Why |
|---|---|
| Access token in memory, refresh token in an HttpOnly cookie | XSS can't steal the long-lived token |
| `localStorage` for preferences, never for tokens | Any script on the page can read it |
| `prepareHeaders` reads the token from the store | Refreshed tokens are used immediately |
| 401 → refresh **once** → retry, behind a mutex | Parallel refreshes break rotating tokens |
| Never refresh on a 401 from `/auth/*` | No infinite loops |
| A `'checking'` state while restoring the session | No wrong redirect to /login on F5 |
| `RequireAuth` with `<Outlet />` for route groups and roles | Protection declared once in the router |
| Claims in the UI are for display only | Security is checked by the API |
| `resetApiState()` on logout | The next user never sees the previous user's data |
| `jwt-decode` v4: `import { jwtDecode }` | The default import was removed |

>
> ## That's it & see you soon!.
>
