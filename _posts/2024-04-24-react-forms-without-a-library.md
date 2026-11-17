---
layout: post
title: "Forms in React without a library - useReducer, validation and server errors"
date: 2024-04-24
author: Malekbenz
comments: true
category: React
tags : [ 'React', 'Javascript']
categories: ['React', 'Javascript']
description: 'Forms in React without a library - useReducer, validation and server errors'
image: /images/covers/react-forms-without-a-library.png
---

Ten `useState` for ten fields, an `onChange` written ten times, the errors in another `useState`, a `loading` flag in a third one — and when the API answers "400, this field is wrong", the message ends up in an `alert()` because there's no clean way to show it under the right input. That's how most of my early React forms looked. You don't need a form library to fix it: a **reducer**, a **pure validation function**, and a **small custom hook** go a long way. Let's build an order form step by step, including dynamic lines and the server's validation errors from the [FluentValidation post](/blog/2024/04/10/fluentvalidation-aspnet-core-validate-once).

## The core idea: one state, one handler, one validate function

```sql
              ┌──────────── form state (one object) ────────────┐
input change ─►  values   { customerId, deliveryType, lines[] }  │
input blur   ─►  touched  { customerId: true, ... }              │
validate()   ─►  errors   { "lines.1.quantity": "..." }          │
submit       ─►  status   'idle' | 'submitting' | 'error'        │
              └──────────────────────────────────────────────────┘
```

Instead of many independent `useState`, the whole form lives in **one object**, changed by **one reducer**. Validation is a **pure function** `values → errors`, easy to test and to keep in sync with the server rules.

> **A form is just state + rules + a submit. Keep each of them in one place.**

---

## Option 1: the simplest forms don't need state at all

For a small form (login, search, contact), let the browser do the work:

```jsx
function LoginForm({ onLogin }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));   // { userName, password }
    onLogin(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="userName" required autoComplete="username" />
      <input name="password" type="password" required minLength={8} autoComplete="current-password" />
      <button>Log in</button>
    </form>
  );
}
```

No `useState`, no `onChange`: the inputs are **uncontrolled**, and `FormData` reads them on submit. Native attributes (`required`, `minLength`, `type="email"`, `min`, `max`) give you validation and messages for free. Use this whenever it's enough.

When the form gets real — conditional fields, lists, server errors, edit mode — move to option 2.

---

## Option 2: a reducer for the form state

```js
// forms/formReducer.js
export const initialFormState = (values) => ({
  values,
  touched: {},
  errors: {},
  status: 'idle',
});

export function formReducer(state, action) {
  switch (action.type) {
    case 'change':
      return { ...state, values: setIn(state.values, action.path, action.value) };
    case 'blur':
      return { ...state, touched: { ...state.touched, [action.path]: true } };
    case 'errors':
      return { ...state, errors: action.errors };
    case 'status':
      return { ...state, status: action.status };
    case 'reset':
      return initialFormState(action.values);
    default:
      throw new Error(`Unknown action ${action.type}`);
  }
}

// setIn({ lines: [{ quantity: 1 }] }, 'lines.0.quantity', 5) → a NEW object, nothing mutated
export function setIn(obj, path, value) {
  const [key, ...rest] = path.split('.');
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[key] = rest.length ? setIn(obj?.[key] ?? {}, rest.join('.'), value) : value;
  return copy;
}

export const getIn = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
```

Field names are **paths**: `customerId`, `deliveryAddress.city`, `lines.1.quantity`. One `change` action handles every field, even nested ones and list items.

---

## Validation: a pure function

```js
// orders/validateOrder.js — the same rules as the server validator
export function validateOrder(v) {
  const errors = {};

  if (!(v.customerId > 0)) errors.customerId = 'Choose a customer.';

  if (!['Pickup', 'Home'].includes(v.deliveryType))
    errors.deliveryType = 'Delivery type must be Pickup or Home.';

  if (v.deliveryType === 'Home') {
    if (!v.deliveryAddress.street?.trim()) errors['deliveryAddress.street'] = 'Street is required.';
    if (!v.deliveryAddress.city?.trim()) errors['deliveryAddress.city'] = 'City is required.';
  }

  if (v.lines.length === 0) errors.lines = 'An order needs at least one line.';

  v.lines.forEach((line, i) => {
    if (!line.productCode?.trim()) errors[`lines.${i}.productCode`] = 'Product is required.';
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000)
      errors[`lines.${i}.quantity`] = 'Quantity must be between 1 and 1000.';
  });

  return errors;   // {} = valid
}
```

No React, no DOM: you can unit test it with plain Jest/Vitest. The server **still** validates everything — client-side validation is for comfort (instant feedback), server-side validation is for safety.

---

## A small useForm hook

Now wrap the reducer in a reusable hook:

```js
// forms/useForm.js
import { useReducer, useCallback } from 'react';
import { formReducer, initialFormState, getIn } from './formReducer';

export function useForm({ initialValues, validate }) {
  const [state, dispatch] = useReducer(formReducer, initialValues, initialFormState);

  const field = useCallback((path) => {
    const error = state.touched[path] || state.status === 'error' ? state.errors[path] : undefined;
    return {
      name: path,
      value: getIn(state.values, path) ?? '',
      onChange: (e) => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        dispatch({ type: 'change', path, value });
      },
      onBlur: () => {
        dispatch({ type: 'blur', path });
        dispatch({ type: 'errors', errors: validate(state.values) });
      },
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${path}-error` : undefined,
      error,
    };
  }, [state, validate]);

  const handleSubmit = (onValid) => async (e) => {
    e.preventDefault();
    const errors = validate(state.values);
    dispatch({ type: 'errors', errors });

    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'status', status: 'error' });
      focusFirstError(errors);
      return;
    }

    dispatch({ type: 'status', status: 'submitting' });
    try {
      await onValid(state.values);
      dispatch({ type: 'status', status: 'idle' });
    } catch (err) {
      dispatch({ type: 'status', status: 'error' });
      throw err;
    }
  };

  return { ...state, dispatch, field, handleSubmit };
}

function focusFirstError(errors) {
  const first = Object.keys(errors)[0];
  document.querySelector(`[name="${first}"]`)?.focus();
}
```

Two UX choices are baked in:

- **Errors show after blur or after a submit attempt** — not while the user is still typing the first letter. Red messages on an empty form you just opened feel aggressive.
- **Focus the first invalid field** on submit, so keyboard and screen reader users land where the problem is.

### A field component

```jsx
function TextField({ label, error, ...props }) {
  return (
    <div className="field">
      <label htmlFor={props.name}>{label}</label>
      <input id={props.name} {...props} />
      {error && <p id={`${props.name}-error`} className="field-error">{error}</p>}
    </div>
  );
}
```

```jsx
<TextField label="Street" {...field('deliveryAddress.street')} />
```

One line per field, with label, value, change, blur, error message and accessibility attributes.

---

## Dynamic lists: order lines

```jsx
const newLine = () => ({ id: crypto.randomUUID(), productCode: '', quantity: 1 });

function OrderLines({ form }) {
  const { values, dispatch, field } = form;

  const setLines = (lines) => dispatch({ type: 'change', path: 'lines', value: lines });

  return (
    <fieldset>
      <legend>Lines</legend>

      {values.lines.map((line, i) => (
        <div key={line.id} className="line">
          <TextField label="Product" {...field(`lines.${i}.productCode`)} />
          <TextField label="Quantity" type="number" min={1} {...field(`lines.${i}.quantity`)} />
          <button type="button" onClick={() => setLines(values.lines.filter((l) => l.id !== line.id))}>
            Remove
          </button>
        </div>
      ))}

      <button type="button" onClick={() => setLines([...values.lines, newLine()])}>Add a line</button>
      {form.errors.lines && <p className="field-error">{form.errors.lines}</p>}
    </fieldset>
  );
}
```

The important detail: **`key={line.id}`, not `key={i}`**. With the index as key, removing line 2 makes React reuse line 2's inputs for line 3 — focus, typed text and error messages jump to the wrong row. A stable id per line (here `crypto.randomUUID()`) keeps each row's identity.

And note the `type="button"` on Add/Remove: inside a `<form>`, a button without a type is a **submit** button.

---

## Submitting with RTK Query, and server errors

```jsx
function OrderForm({ initialValues }) {
  const [createOrder] = useCreateOrderMutation();
  const form = useForm({ initialValues, validate: validateOrder });
  const conditionalAddress = form.values.deliveryType === 'Home';

  const onValid = async (values) => {
    try {
      await createOrder(toRequest(values)).unwrap();
      form.dispatch({ type: 'reset', values: initialValues });
    } catch (err) {
      if (err.status === 400 && err.data?.errors) {
        form.dispatch({ type: 'errors', errors: fromServerErrors(err.data.errors) });
        form.dispatch({ type: 'status', status: 'error' });
        return;
      }
      throw err;
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onValid)} noValidate>
      {/* customer, delivery type... */}
      {conditionalAddress && (
        <>
          <TextField label="Street" {...form.field('deliveryAddress.street')} />
          <TextField label="City" {...form.field('deliveryAddress.city')} />
        </>
      )}
      <OrderLines form={form} />
      <button disabled={form.status === 'submitting'}>
        {form.status === 'submitting' ? 'Saving…' : 'Save order'}
      </button>
    </form>
  );
}
```

The API returns `ValidationProblemDetails` with **C# paths** (`DeliveryAddress.City`, `Lines[1].Quantity`). One small function converts them to our form paths:

```js
// "Lines[1].Quantity" → "lines.1.quantity",  "DeliveryAddress.City" → "deliveryAddress.city"
export function fromServerErrors(serverErrors) {
  const errors = {};
  for (const [key, messages] of Object.entries(serverErrors)) {
    const path = key
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .map((part) => part.charAt(0).toLowerCase() + part.slice(1))
      .join('.');
    errors[path] = messages[0];
  }
  return errors;
}
```

Now a rule that only the server knows ("Unknown product 'XYZ'", checked in the database) appears **under the right input**, exactly like a client-side error. That's the payoff of one error format on the server.

`noValidate` on the `<form>` turns off the browser's own bubbles, since we show our own messages.

---

## Edit forms: no useEffect to copy the data

```jsx
// ❌ Copying the loaded order into the form state with an effect
useEffect(() => { form.dispatch({ type: 'reset', values: order }); }, [order]);

// ✅ Render the form only when the data is there, and reset it with a key
function EditOrderPage({ id }) {
  const { data: order, isLoading } = useGetOrderQuery(id);
  if (isLoading) return <p>Loading…</p>;
  return <OrderForm key={order.id} initialValues={toFormValues(order)} />;
}
```

`useReducer(formReducer, initialValues, initialFormState)` uses `initialValues` only **once**, on mount. With `key={order.id}`, opening another order creates a fresh form — no effect, no flicker, no half-old half-new state.

---

## When should you use a library?

Writing your own works well up to medium forms. Consider React Hook Form (and a schema library like Zod) when:

| Situation | Own hook | Library |
|---|---|---|
| A few forms, < 20 fields | ✅ Simple, no dependency | Overkill |
| Big forms (100+ inputs), performance issues | Every keystroke re-renders the form | ✅ Uncontrolled, minimal re-renders |
| Many forms with similar needs | You maintain the hook | ✅ Maintained, documented |
| Complex dynamic arrays, nested arrays | Doable, more code | ✅ Built-in helpers |
| Team wants zero dependencies | ✅ | — |

The concepts are the same either way — one state, pure rules, server errors mapped to fields — so what you learn here transfers directly.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Small forms: uncontrolled inputs + `FormData` | No state needed at all |
| Bigger forms: one reducer, field names as paths | One handler for every field, nested and lists |
| Validation is a pure `values → errors` function | Testable, mirrors the server rules |
| The server always validates too | Client validation is comfort, not security |
| Show errors after blur or submit, focus the first one | Friendly and accessible |
| `aria-invalid` + `aria-describedby` on invalid inputs | Screen readers announce the error |
| Stable `key` (an id) for list rows, never the index | Inputs and errors stay on the right row |
| `type="button"` for non-submit buttons in a form | Otherwise they submit the form |
| Map `ValidationProblemDetails` paths to form paths | Server errors appear under the right input |
| Edit forms: render when loaded + `key`, no copy effect | Fresh state per record, no flicker |
| Reach for a library for very large or numerous forms | Performance and maintenance |

>
> ## That's it & see you soon!.
>
