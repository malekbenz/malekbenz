---
layout: post
title: "What's new in React 19 - Actions, useOptimistic, use() and the upgrade from 18"
date: 2024-12-18
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Javascript']
categories: ['React', 'Javascript']
description: 'What is new in React 19 - Actions, useOptimistic, use() and the upgrade from 18'
image: /images/covers/whats-new-in-react-19.png
---

React 19 became stable on December 5, 2024 — the first major version in more than two years. It doesn't change how you write components, but it removes a lot of the plumbing we wrote all year: the `isSaving` flags, the `try/catch/finally` around every submit, the manual optimistic updates, the `forwardRef` wrappers. In April I built [forms without a library](/blog/2024/04/24/react-forms-without-a-library) with a reducer and a custom hook; React 19 now has a built-in answer for a big part of that. Let's go through the new features with before/after examples, then the upgrade from React 18 — and finish with a recap of this year's React posts.

## The core idea: Actions

Almost every "save" in a React app looks the same:

```jsx
// React 18
function RenameCustomer({ customer }) {
  const [name, setName] = useState(customer.name);
  const [error, setError] = useState(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async () => {
    setIsPending(true);
    setError(null);
    try {
      await updateCustomerName(customer.id, name);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsPending(false);
    }
  };
  // ...
}
```

React 19 calls an async function used in a transition an **Action**, and manages the pending state for you:

```jsx
// React 19
function RenameCustomer({ customer }) {
  const [name, setName] = useState(customer.name);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    startTransition(async () => {                  // async transitions are new in React 19
      const result = await updateCustomerName(customer.id, name);
      if (result.error) setError(result.error);
    });
  };

  return (
    <>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={handleSubmit} disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
```

`isPending` is `true` from the start of the action until it finishes — no manual flag, and React keeps the UI responsive while it runs.

> **An Action is "an async function that changes data", and React 19 tracks its pending state, its errors and its optimistic updates for you.**

---

## useActionState and form actions

For forms, React 19 goes further: a `<form>` can take a **function** as its `action`.

```jsx
import { useActionState } from 'react';

async function renameAction(previousState, formData) {
  const name = formData.get('name')?.toString().trim();
  if (!name) return { error: 'Name is required.' };

  const response = await fetch(`/api/customers/${formData.get('id')}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const problem = await response.json();                 // ProblemDetails from the API
    return { error: problem.detail ?? 'Could not save.' };
  }
  return { error: null, savedAt: new Date().toLocaleTimeString() };
}

function RenameCustomerForm({ customer }) {
  const [state, formAction, isPending] = useActionState(renameAction, { error: null });

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={customer.id} />
      <input name="name" defaultValue={customer.name} />
      <button disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</button>
      {state.error && <p className="error">{state.error}</p>}
      {state.savedAt && <p className="ok">Saved at {state.savedAt}</p>}
    </form>
  );
}
```

What changed compared with April's version:

- No `onSubmit`, no `preventDefault`, no `useState` per field: the form's **`FormData`** goes to the action (uncontrolled inputs, like the simplest option of the April post).
- The action returns the **next state** (here: an error or a success message); `useActionState` gives it back with `isPending`.
- After a successful action, React **resets** uncontrolled form fields automatically.

For big forms with dynamic lines and per-field client validation, the reducer approach from April is still a good fit. For the many small forms of an app (rename, comment, settings), form actions remove almost all the code.

### useFormStatus: the submit button knows

```jsx
import { useFormStatus } from 'react-dom';

function SubmitButton({ children }) {
  const { pending } = useFormStatus();        // the status of the PARENT <form>
  return <button disabled={pending}>{pending ? 'Saving…' : children}</button>;
}

<form action={formAction}>
  <input name="name" />
  <SubmitButton>Save</SubmitButton>
</form>
```

A reusable button that disables itself during any form action — no props to pass down. It must be rendered **inside** the `<form>`.

---

## useOptimistic

In November we did [optimistic updates in the RTK Query cache](/blog/2024/11/13/rtk-query-in-depth) with `updateQueryData` and `undo`. For local state, React 19 has a hook:

```jsx
import { useOptimistic, useTransition } from 'react';

function FavoriteButton({ order, onToggle }) {
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(order.favorite);
  const [, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      setOptimisticFavorite(!order.favorite);     // shown immediately
      await onToggle(order.id, !order.favorite);  // when it finishes, the real value takes over
    });
  };

  return <button onClick={toggle}>{optimisticFavorite ? '★' : '☆'}</button>;
}
```

While the action runs, the component shows the **optimistic** value. When it ends, React switches back to the real `order.favorite` — the new value if the save succeeded and the parent re-rendered, the old one if it failed. No manual rollback.

---

## use(): read a promise or a context

`use` is a new API that reads a **resource** during render:

```jsx
import { use, Suspense } from 'react';

function OrderDetails({ orderPromise }) {
  const order = use(orderPromise);                // suspends until the promise resolves
  return <h2>Order #{order.id} — {order.total} €</h2>;
}

// The parent creates (and caches) the promise, Suspense shows the fallback
<Suspense fallback={<p>Loading order…</p>}>
  <OrderDetails orderPromise={orderPromise} />
</Suspense>
```

Two important details:

- The promise must be **created outside the render** (by a parent, a router loader, or a cache). Creating `fetch(...)` inside the component that calls `use` would start a new request on every render. In client apps that already use RTK Query, keep using its hooks for data — `use` shines with frameworks and routers that hand you promises.
- Unlike other hooks, `use` can be called **conditionally**:

```jsx
function Price({ amount, showCurrency }) {
  if (!showCurrency) return amount;
  const { currency } = use(SettingsContext);     // ✅ allowed inside a condition
  return `${amount} ${currency}`;
}
```

---

## ref as a prop, Context as a provider

Two small changes that remove a lot of boilerplate:

```jsx
// React 18: forwardRef to pass a ref to a function component
const TextInput = forwardRef(function TextInput(props, ref) {
  return <input ref={ref} {...props} />;
});

// React 19: ref is just a prop
function TextInput({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}
```

```jsx
// React 18
<ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>

// React 19
<ThemeContext value={theme}>{children}</ThemeContext>
```

`forwardRef` and `Context.Provider` still work; they'll be deprecated in a future version. Ref callbacks can also return a **cleanup function** now, like effects.

---

## Document metadata

Components can render `<title>`, `<meta>` and `<link>` tags; React moves them into the document `<head>`:

```jsx
function OrderPage({ order }) {
  return (
    <>
      <title>{`Order #${order.id} — Shop`}</title>
      <meta name="description" content={`Details of order ${order.id}`} />
      <OrderDetails order={order} />
    </>
  );
}
```

No more `useEffect(() => { document.title = ... })` or a separate library for the page title.

---

## Upgrading from React 18

```sql
1. Upgrade to React 18.3 first — it adds warnings for everything removed in 19
2. Fix the warnings, then: npm install react@19 react-dom@19
3. Run the codemods:  npx codemod@latest react/19/migration-recipe
4. Check your libraries (router, state, UI kit, data grid) for React 19 support
5. Run the tests, check the console for new warnings
```

What's removed (most apps are only touched by the first two):

| Removed | Replace with |
|---|---|
| `ReactDOM.render` / `hydrate` | `createRoot(...).render(...)` / `hydrateRoot` (React 18 APIs) |
| `propTypes` and `defaultProps` on function components | Default values in destructuring: `function Button({ size = 'md' })` |
| String refs (`ref="input"`), legacy context, `findDOMNode` | Callback / object refs, `createContext`, refs |
| `react-test-renderer/shallow` | Testing Library |

If you followed this year's posts — `createRoot`, function components, hooks, default values in destructuring — the upgrade is mostly a version bump.

---

## A year of React on this blog

| Month | Post |
|---|---|
| January | [React + ASP.NET Core, from Vite to production](/blog/2024/01/24/react-aspnet-core-vite-to-production) |
| February | [Authentication: JWT, protected routes, automatic refresh](/blog/2024/02/21/react-authentication-jwt-refresh-rtk-query) |
| March | [React hooks explained](/blog/2024/03/20/react-hooks-explained) |
| April | [Forms without a library](/blog/2024/04/24/react-forms-without-a-library) |
| May | [Custom hooks](/blog/2024/05/22/react-custom-hooks) |
| July | [Big tables with AG Grid](/blog/2024/07/24/react-ag-grid-server-side-data) |
| September | [Performance: measure, then fix](/blog/2024/09/25/react-performance-measure-then-fix) |
| November | [RTK Query in depth](/blog/2024/11/13/rtk-query-in-depth) |
| December | React 19 (this post) |

---

## Key rules to remember

| Rule | Why |
|---|---|
| Async functions in `startTransition` are Actions | Pending state handled by React |
| `useActionState` + `<form action={fn}>` for small forms | No `onSubmit`, no flags, FormData in, state out |
| `useFormStatus` inside the form for submit buttons | Reusable buttons that know the form is pending |
| `useOptimistic` for instant local feedback | Automatic return to the real value |
| `use(promise)` only with promises created outside render | Otherwise a new request each render |
| `use(Context)` can be conditional | The one "hook" exempt from that rule |
| `ref` is a prop, `<Context value>` is the provider | Less boilerplate, no `forwardRef` |
| `<title>` and `<meta>` in components | No effects for document metadata |
| Upgrade via React 18.3 + codemods, check libraries | Warnings first, then the version bump |

>
> ## That's it & see you soon!.
>
