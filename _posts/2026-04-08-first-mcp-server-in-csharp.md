---
layout: post
title: "Your first MCP server in C# - Tools, stdio and connecting it to an AI assistant"
date: 2026-04-08
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'AI', 'MCP']
categories: ['.Net', 'AI']
description: 'Your first MCP server in C# - Tools, stdio and connecting it to an AI assistant'
image: /images/covers/first-mcp-server-in-csharp.png
---

An AI assistant is good at language, and bad at everything it can't see: your database, your files, your company's APIs, today's date in the right time zone. The **Model Context Protocol (MCP)** fixes that with a simple idea: you write a small server that exposes **tools**, and any MCP-compatible assistant — VS Code's Copilot chat, Claude Desktop, your own app — can discover them and call them. The official C# SDK reached **1.0 last month**, so it's a good time to start. I've built a few MCP servers over the last months, from toy samples to tools over a business database; this first post covers the foundations — and the one mistake that made my first server silently fail.

## The core idea: host, client, server

```sql
┌──────────────── Host (VS Code, Claude Desktop, your app) ────────────────┐
│   LLM  ◄──►  MCP client ──┐      MCP client ──┐                          │
└───────────────────────────┼──────────────────┼──────────────────────────┘
                            ▼                  ▼
                  MCP server (yours)      MCP server (files, git...)
                  tools: get_time,        tools: read_file, ...
                         new_guid ...
```

- The **host** is the application the user talks to. It contains the LLM and one **MCP client** per server.
- Your **server** declares what it offers; the host asks it "what can you do?" (`tools/list`) and, when the model decides to use a tool, "please run this" (`tools/call`).
- The model never runs your code directly: it **asks** for a tool call with arguments, the host forwards it, your C# runs, and the result goes back into the conversation.

A server can expose three kinds of things:

| Primitive | Who decides to use it | Example |
|---|---|---|
| **Tools** | The model | `get_order_status(orderId)`, `convert_time(...)` |
| **Resources** | The application / user | A document, a schema, a file the host can attach as context |
| **Prompts** | The user | Reusable prompt templates ("Review this SQL query") |

Tools are by far the most used — we'll focus on them.

> **An MCP server is a plug-in for AI assistants: write it once, and every MCP host can use it.**

---

## Transports: stdio or HTTP

| Transport | How | Good for |
|---|---|---|
| **stdio** | The host **starts your server as a process** and talks JSON-RPC through its stdin/stdout | Local tools, one user, no network, no hosting |
| **Streamable HTTP** | Your server is a web app; hosts connect to a URL | Shared servers, several users, remote access |

We start with **stdio**: nothing to deploy, the host launches your `.exe` (or `dotnet run`) when it needs it. HTTP comes in the next post, for a server over a business database.

---

## Creating the project

```sql
dotnet new console -n DevToolbox.Mcp
cd DevToolbox.Mcp
dotnet add package ModelContextProtocol
dotnet add package Microsoft.Extensions.Hosting
```

`ModelContextProtocol` is the official SDK (maintained with Microsoft); `Microsoft.Extensions.Hosting` gives us the usual host: DI, configuration, logging.

```csharp
// Program.cs
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// stdout is reserved for the MCP protocol: send ALL logs to stderr
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);

builder.Services
    .AddMcpServer()
    .WithStdioServerTransport()
    .WithToolsFromAssembly();          // registers every [McpServerToolType] class in this assembly

await builder.Build().RunAsync();
```

That's the whole server. The SDK handles the protocol: the initialization handshake, `tools/list`, `tools/call`, argument binding, JSON serialization.

---

## The stdout trap

With stdio, **stdout is the protocol channel**. Every byte written to it must be a valid JSON-RPC message. My first server had this innocent line at the top of `Program.cs`:

```csharp
Console.WriteLine("Registering MCP server with the developer tools...");   // ❌
```

The host started the process, read `Registering MCP server...` where it expected JSON, and failed to connect — with an error that didn't mention my line at all. In some hosts the server just appears as "not responding".

```sql
stdout  →  JSON-RPC messages ONLY
stderr  →  logs, debug output, anything else
```

Hence the `LogToStandardErrorThreshold = LogLevel.Trace` line above: all `ILogger` output goes to stderr, which hosts show in their logs. And no `Console.WriteLine` anywhere — use `ILogger`, or `Console.Error.WriteLine` if you really must.

---

## Writing tools

A tool is a method on a class marked `[McpServerToolType]`:

```csharp
using System.ComponentModel;
using ModelContextProtocol.Server;

[McpServerToolType]
public sealed class TimeTools
{
    [McpServerTool, Description("Converts a date and time from one time zone to another. Use IANA zone ids like 'Europe/Paris' or 'America/New_York'.")]
    public static string ConvertTime(
        [Description("Date and time to convert, ISO 8601, e.g. '2026-04-08T14:30:00'")] DateTime dateTime,
        [Description("Source time zone id, e.g. 'Europe/Paris'")] string fromZone,
        [Description("Target time zone id, e.g. 'Asia/Tokyo'")] string toZone)
    {
        var from = TimeZoneInfo.FindSystemTimeZoneById(fromZone);
        var to = TimeZoneInfo.FindSystemTimeZoneById(toZone);
        var utc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(dateTime, DateTimeKind.Unspecified), from);
        return TimeZoneInfo.ConvertTimeFromUtc(utc, to).ToString("yyyy-MM-dd HH:mm");
    }

    [McpServerTool, Description("Returns the current date and time in a given time zone.")]
    public static string Now([Description("Time zone id, e.g. 'Europe/Paris'")] string zone = "UTC") =>
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTime.UtcNow, zone).ToString("yyyy-MM-dd HH:mm:ss");
}
```

From this, the SDK generates the tool **schema** the model sees: the name (from the method name, or set explicitly with `[McpServerTool(Name = "convert_time")]`), the description, and a JSON Schema for the parameters (types, which are required, which have defaults). The `[Description]` attributes are not documentation for humans — they're **instructions for the model**.

### Parameters, DI services and cancellation

Tool classes can use dependency injection, and tool methods can receive services and a `CancellationToken` directly — the SDK fills them in and hides them from the model:

```csharp
using System.Security.Cryptography;
using System.Text;

[McpServerToolType]
public sealed class IdTools(ILogger<IdTools> logger)
{
    [McpServerTool, Description("Generates new time-ordered GUIDs (version 7), suitable as database keys.")]
    public string[] NewGuids([Description("How many GUIDs to generate (1-50)")] int count = 1)
    {
        count = Math.Clamp(count, 1, 50);                      // never trust arguments, even from a model
        logger.LogInformation("Generating {Count} GUIDs", count);
        return Enumerable.Range(0, count).Select(_ => Guid.CreateVersion7().ToString()).ToArray();
    }

    [McpServerTool, Description("Computes the SHA-256 hash of a text, in hexadecimal.")]
    public static async Task<string> HashText(
        [Description("The text to hash")] string text,
        CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(text));
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash);
    }
}
```

### Return values and errors

| Return | The model receives |
|---|---|
| `string` | That text |
| An object / array | Its JSON serialization |
| `Task<T>` / `ValueTask<T>` | The same, asynchronously |
| An exception | An **error result** (`isError: true`) |

When something is wrong with the request, throw an `McpException` with a message the **model can act on** — it will often fix its call and retry:

```csharp
if (!TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _))
    throw new McpException($"Unknown time zone '{zone}'. Use an IANA id such as 'Europe/Paris' or 'UTC'.");
```

Other, unexpected exceptions are reported to the client as a generic error, without their internal details — the same "don't leak internals" rule as for [web APIs](/blog/2024/05/08/aspnet-core-global-error-handling-iexceptionhandler).

---

## Descriptions are your prompt

The model chooses tools and fills arguments **only** from names and descriptions. Compare:

```csharp
// ❌ The model has to guess everything
[McpServerTool, Description("Converts time")]
public static string Convert(string a, string b, string c) { ... }

// ✅ What it does, when to use it, what the formats are
[McpServerTool, Description("Converts a date and time from one time zone to another. Use IANA zone ids like 'Europe/Paris'.")]
public static string ConvertTime(
    [Description("Date and time to convert, ISO 8601, e.g. '2026-04-08T14:30:00'")] DateTime dateTime, ...)
```

Rules that made a real difference in my servers:

- **Say when to use the tool**, not only what it does ("Use this to find an order when the user gives an order number").
- **Give formats and examples** for every non-obvious parameter (dates, ids, units).
- **One tool, one job**: `get_order` and `cancel_order`, not `manage_order(action, ...)`.
- **Keep the number of tools reasonable**: dozens of similar tools confuse the model and fill its context.

---

## Testing with the MCP Inspector

Before connecting a real assistant, test the server with the **MCP Inspector**, a small web UI from the MCP project:

```sql
npx @modelcontextprotocol/inspector dotnet run --project ./DevToolbox.Mcp
```

It starts your server, connects as a client, and lets you list the tools, see their generated schemas, call them with arguments, and read the raw messages and stderr logs. If something fails here, it will fail in every host — and here you can see why.

---

## Connecting it to an assistant

### VS Code

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "dev-toolbox": {
      "type": "stdio",
      "command": "dotnet",
      "args": ["run", "--project", "C:/src/DevToolbox.Mcp"]
    }
  }
}
```

Open the chat in **agent mode**: the toolbox tools appear in the tools list, and asking "What time is it in Tokyo when it's 14:30 in Paris?" makes the model call the time conversion tool — VS Code asks for your confirmation before running it.

### Claude Desktop

In `claude_desktop_config.json` (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "dev-toolbox": {
      "command": "C:/tools/DevToolbox.Mcp/DevToolbox.Mcp.exe",
      "args": []
    }
  }
}
```

Restart the app; the tools appear in the chat's tools menu. Both formats are just "how to start the process" — which is why a stdio server needs no hosting at all.

---

## Publishing the server

`dotnet run` is fine while developing, but it compiles on every start (slow, and it needs the SDK). Publish a single executable for real use:

```sql
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o C:\tools\DevToolbox.Mcp
```

Then point the host's `command` at the `.exe`. Startup becomes instant, and colleagues can use it without installing the .NET SDK.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Host ↔ client ↔ server: the model asks, the host calls your tool | Your code stays in your control |
| stdio for local tools, HTTP for shared servers | No hosting needed for stdio |
| `AddMcpServer().WithStdioServerTransport().WithToolsFromAssembly()` | The whole server setup |
| Nothing on stdout but the protocol — logs to stderr | One `Console.WriteLine` breaks the connection |
| `[McpServerToolType]` + `[McpServerTool]` + `[Description]` | Tools and their schema, generated |
| Descriptions are instructions for the model | Say what, when, and the formats |
| Validate and clamp arguments | Models make mistakes too |
| `McpException` with an actionable message | The model can correct its call |
| Test with the MCP Inspector first | See schemas, calls and logs directly |
| Publish a single exe for real use | Fast startup, no SDK needed |

>
> ## That's it & see you soon!.
>
