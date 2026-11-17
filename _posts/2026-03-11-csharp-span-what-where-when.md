---
layout: post
title: "Span in C# - What it is, where to use it, and when not to"
date: 2026-03-11
author: Malekbenz
comments: true
category: C#
tags : [ 'C#', '.Net']
categories: ['C#', '.Net']
description: 'Span in C# - What it is, where to use it, and when not to'
image: /images/covers/csharp-span-what-where-when.png
---

`Substring`, `Split`, `ToArray`, `Skip(...).Take(...)`... each of these calls creates a **new** string or array, copies the data into it, and leaves garbage for the GC to clean. In one line of code it doesn't matter. In a loop that parses a 2 GB file, or in an API handling 5,000 requests per second, it's where your memory and CPU go. `Span<T>` fixes exactly this. Let's see what it is with simple examples, where it helps, and — just as important — when you shouldn't bother.

## The core idea: a window over memory, no copy

A `Span<T>` is a **view** on a piece of memory: a pointer to the start + a length. It doesn't own the data, it just looks at it.

```sql
int[] numbers = [10, 20, 30, 40, 50, 60];

memory:   [10][20][30][40][50][60]
                ▲           ▲
                └───────────┘
numbers.AsSpan(1, 4)  → a window: start = index 1, length = 4 → 20, 30, 40, 50
                        no new array, no copy
```

That memory can be:

| Memory | Example |
|---|---|
| An array | `new int[100].AsSpan()` |
| A string (read-only) | `"hello".AsSpan()` |
| The stack | `stackalloc byte[256]` |
| Native memory | A buffer from a native library |

The same `Span<T>` code works on all of them.

> **`Span<T>` = "the same data, a smaller window". Slicing is free: no allocation, no copy.**

---

## Simple example 1 — slicing an array

```csharp
int[] numbers = [10, 20, 30, 40, 50, 60];

// ❌ Classic: creates a new array with 4 elements (allocation + copy)
int[] middle = numbers.Skip(1).Take(4).ToArray();

// ✅ Span: a window on the same array (no allocation)
Span<int> window = numbers.AsSpan(1, 4);   // 20, 30, 40, 50

window[0] = 99;                            // writes into the ORIGINAL array
Console.WriteLine(numbers[1]);             // 99
```

Because it's a window and not a copy, writing through the span **changes the original array**. If you don't want that, use `ReadOnlySpan<T>`.

Slicing again is just as free:

```csharp
Span<int> firstTwo = window[..2];      // 99, 30   (range syntax works)
Span<int> lastOne  = window[^1..];     // 50
```

---

## Simple example 2 — parsing a string without Substring

A line from an import file:

```csharp
string line = "2026-03-11;ORD-1042;3;19.90";
```

### The classic way

```csharp
string[] parts = line.Split(';');               // 1 array + 4 new strings

var date     = DateOnly.Parse(parts[0]);
var orderRef = parts[1];
var quantity = int.Parse(parts[2]);
var price    = decimal.Parse(parts[3], CultureInfo.InvariantCulture);
```

5 allocations for one line. For a file of 10 million lines: 50 million objects for the GC.

### The span way

```csharp
ReadOnlySpan<char> span = line.AsSpan();

int i = span.IndexOf(';');
var date = DateOnly.Parse(span[..i]);           // parse directly from the window
span = span[(i + 1)..];

i = span.IndexOf(';');
ReadOnlySpan<char> orderRef = span[..i];        // still no string created
span = span[(i + 1)..];

i = span.IndexOf(';');
var quantity = int.Parse(span[..i]);
var price    = decimal.Parse(span[(i + 1)..], CultureInfo.InvariantCulture);
```

**Zero allocations**. `int.Parse`, `decimal.Parse`, `DateOnly.Parse`, `Guid.Parse`... all have overloads that take a `ReadOnlySpan<char>`. We only create a `string` at the end, if we really need to keep one:

```csharp
string reference = orderRef.ToString();   // the only allocation, and only if needed
```

### Even simpler since .NET 9: Split on a span

```csharp
ReadOnlySpan<char> span = line;           // a string converts to ReadOnlySpan<char>

foreach (Range range in span.Split(';'))
{
    ReadOnlySpan<char> field = span[range];
    // ...
}
```

`MemoryExtensions.Split` gives you the **ranges** of each field, not new strings. Same readability as `string.Split`, no allocations.

---

## ReadOnlySpan&lt;char&gt; & string APIs

Most things you do with strings have a span version in `MemoryExtensions`:

```csharp
ReadOnlySpan<char> s = "  Order: ORD-1042  ".AsSpan().Trim();

s.StartsWith("Order:")                                        // true
s.Contains("1042", StringComparison.Ordinal)                  // true
s.Equals("order: ord-1042", StringComparison.OrdinalIgnoreCase) // true
s.IndexOfAny(':', '-')                                        // 5
s.LastIndexOf('-')                                            // 10
```

`Trim()` on a span doesn't create a string either: it just moves the window.

And for **UTF-8 bytes** (HTTP, files, JSON), the `u8` suffix gives you a `ReadOnlySpan<byte>` with no allocation at all:

```csharp
ReadOnlySpan<byte> header = "Content-Type"u8;
```

---

## stackalloc: small buffers without the heap

Sometimes you need a small temporary buffer — to format a number, build a key, hash something. With `stackalloc`, the buffer lives on the **stack**: it disappears when the method returns, and the GC never sees it.

```csharp
public static string FormatOrderRef(int id)
{
    Span<char> buffer = stackalloc char[16];      // on the stack, no unsafe needed

    "ORD-".CopyTo(buffer);
    id.TryFormat(buffer[4..], out int written);   // write the number directly into the buffer

    return new string(buffer[..(4 + written)]);   // one allocation: the final string
}
```

The stack is **small** (about 1 MB per thread). Two rules:

```csharp
// ✅ Small and fixed size
Span<byte> small = stackalloc byte[256];

// ❌ Size from user input → a big value = StackOverflowException, the process dies
Span<byte> danger = stackalloc byte[request.Length];

// ✅ The safe pattern: stack for small sizes, heap otherwise
Span<byte> buffer = length <= 512 ? stackalloc byte[length] : new byte[length];
```

---

## Where it's used for you

Even if you never write `Span<T>`, you use it every day. A big part of .NET was rewritten on top of it:

| Area | Span-based APIs |
|---|---|
| Parsing | `int.Parse(ReadOnlySpan<char>)`, `Guid.TryParse`, `DateOnly.Parse`... |
| Formatting | `TryFormat(Span<char>, out int written)` on numbers and dates |
| Text | `MemoryExtensions` (`Trim`, `IndexOf`, `Split`, `StartsWith`...) |
| Encoding | `Encoding.UTF8.GetBytes(ReadOnlySpan<char>, Span<byte>)` |
| I/O | `Stream.Read(Span<byte>)`, `Stream.ReadAsync(Memory<byte>)` |
| JSON | `System.Text.Json` (`Utf8JsonReader` works on `ReadOnlySpan<byte>`) |
| Kestrel | The ASP.NET Core server parses HTTP with spans |

That's one of the reasons each .NET version gets faster without you changing your code.

And with **C# 14** (.NET 10), spans are "first-class": arrays convert implicitly to `Span<T>` and `ReadOnlySpan<T>`, so span-based extension methods work directly on arrays, and the compiler picks the span overloads more often.

---

## The rules: Span is a ref struct

A `Span<T>` can point to the **stack**. If it could escape to the heap, it could point to memory that doesn't exist anymore. So `Span<T>` is a `ref struct`, and the compiler enforces strict rules:

```csharp
class OrderParser
{
    private Span<char> _buffer;              // ❌ CS8345: can't be a field of a class
}

object o = span;                             // ❌ can't be boxed

Func<int> f = () => span.Length;             // ❌ can't be captured by a lambda

async Task ProcessAsync()
{
    Span<byte> buffer = stackalloc byte[64];
    await Task.Delay(10);
    buffer[0] = 1;                           // ❌ can't be used across an await
}
```

About `async`: since C# 13 you **can** declare a span inside an async method, as long as you don't use it across an `await`. The code between two awaits can use spans freely.

These errors are good news: the compiler stops you before you create a memory bug.

---

## Memory&lt;T&gt; when you need async

When you need to **keep** the window — in a field, across an `await`, in a lambda — use `Memory<T>`. It's the same idea (a window, no copy), but it's a normal struct that can live on the heap:

```csharp
public async Task<int> CountLinesAsync(Stream stream)
{
    Memory<byte> buffer = new byte[64 * 1024];
    int lines = 0, read;

    while ((read = await stream.ReadAsync(buffer)) > 0)     // Memory<T> across await ✅
    {
        lines += buffer.Span[..read].Count((byte)'\n');     // .Span for the synchronous work
    }

    return lines;
}
```

The rule of thumb:

| Need | Use |
|---|---|
| Synchronous code, local variable, parameter | `Span<T>` / `ReadOnlySpan<T>` |
| Field, async method, lambda, collection | `Memory<T>` / `ReadOnlyMemory<T>` |
| Do the actual work | `memory.Span` inside the synchronous part |

---

## When NOT to use it

Span is a performance tool, not a style. Don't use it:

- **In normal business code.** `order.Reference.Substring(0, 3)` in a controller called 10 times per minute? Leave it. The readable version wins.
- **When you need a string anyway.** If every field ends in a `string` property of an object, `ToString()` allocates anyway — the gain is small.
- **Without measuring.** Optimize the hot paths you **found** with a profiler or a benchmark, not the ones you imagine.

Where it really pays:

```sql
✅ Parsing big files (CSV, logs, fixed-width formats)
✅ Hot paths in an API (middlewares, serializers, key building for caches)
✅ Libraries used by many apps
✅ Protocol / binary data (bytes from sockets, devices, files)
```

---

## Benchmark: Substring vs Span

Measure it yourself with **BenchmarkDotNet** — the `Allocated` column tells the story:

```csharp
[MemoryDiagnoser]
public class ParseBenchmarks
{
    private const string Line = "2026-03-11;ORD-1042;3;19.90";

    [Benchmark(Baseline = true)]
    public int WithSplit()
    {
        string[] parts = Line.Split(';');
        return int.Parse(parts[2]);
    }

    [Benchmark]
    public int WithSpan()
    {
        ReadOnlySpan<char> span = Line;
        int sum = 0;
        int index = 0;
        foreach (Range range in span.Split(';'))
        {
            if (index++ == 2)
                sum = int.Parse(span[range]);
        }
        return sum;
    }
}
```

```sql
dotnet run -c Release
```

What you should see: the `Split` version allocates for the array and each string on **every** call, while the span version shows **0 B** allocated — and it's usually faster too, because there's nothing to copy and nothing for the GC to collect.

---

## Key rules to remember

| Rule | Why |
|---|---|
| A span is a window on existing memory | Slicing doesn't allocate or copy |
| Writing through a `Span<T>` changes the original | Use `ReadOnlySpan<T>` when you only read |
| Parse directly from spans (`int.Parse(span)`) | No intermediate strings |
| Use `span.Split(...)` (.NET 9+) instead of `string.Split` in hot loops | Ranges instead of new strings |
| `stackalloc` only for small, fixed sizes | The stack is ~1 MB — a big size kills the process |
| `Span<T>` is a `ref struct` | No fields, no boxing, no lambdas, not across `await` |
| `Memory<T>` for fields and async code, `.Span` for the work | Same window, allowed on the heap |
| Don't use spans in normal business code | Readability first |
| Measure with BenchmarkDotNet before and after | Optimize real hot paths, not imagined ones |

>
> ## That's it & see you soon!.
>
