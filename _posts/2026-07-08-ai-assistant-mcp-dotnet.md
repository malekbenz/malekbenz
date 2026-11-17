---
layout: post
title: "Your own AI assistant with MCP in .NET - Microsoft.Extensions.AI, any model, your tools"
date: 2026-07-08
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'AI', 'MCP']
categories: ['.Net', 'AI']
description: 'Your own AI assistant with MCP in .NET - Microsoft.Extensions.AI, any model, your tools'
image: /images/covers/ai-assistant-mcp-dotnet.png
---

VS Code and Claude Desktop are great MCP hosts for developers. But the people who needed our tools weren't developers: they needed an assistant **inside our environment**, with **our** servers already configured, running on a **model we choose** — sometimes a local one, because the data must not leave the network. So I built my own host: a console assistant that loads MCP servers from a config file, connects to the model of the day, and lets it call the tools. In [April](/blog/2026/04/08/first-mcp-server-in-csharp) and [May](/blog/2026/05/13/mcp-server-business-database) we wrote servers; today we write the other side — a .NET host with **Microsoft.Extensions.AI** — and the lessons from running it with different models.

## The core idea: host = model + MCP clients + a loop

```sql
User ──► Malekbenz Assistant (your host)
            │ 1. send history + tool list to the model
            ▼
          Model ── "call search_orders(status: Paid)" ──┐
            ▲                                           │ 2. run the tool through the MCP client
            │ 4. final answer                           ▼
            └──── 3. tool result added to the history ◄── MCP server
```

A host does three things:

1. **Connects** to MCP servers and collects their tools.
2. **Sends** the conversation and the tool definitions to a model.
3. **Loops**: when the model asks for a tool, run it, give back the result, and ask the model again — until it answers in text.

> **The model never touches your systems. It asks; your host decides and executes.**

Microsoft.Extensions.AI and the MCP SDK give us all three with very little code.

---

## IChatClient: one interface for every model

`Microsoft.Extensions.AI` defines **`IChatClient`**: one interface for chat models, implemented for OpenAI, Azure OpenAI, Ollama, Anthropic and others. Your host code talks to `IChatClient`; the provider is a configuration detail.

```json
{
  "Model": {
    "Provider": "ollama",
    "Model": "qwen3:14b",
    "Endpoint": "http://localhost:11434"
  }
}
```

```csharp
static IChatClient CreateChatClient(ModelOptions m) => m.Provider switch
{
    "ollama"       => new OllamaApiClient(new Uri(m.Endpoint!), m.Model),                     // OllamaSharp
    "openai"       => new OpenAIClient(m.ApiKey).GetChatClient(m.Model).AsIChatClient(),
    "azure-openai" => new AzureOpenAIClient(new Uri(m.Endpoint!), new DefaultAzureCredential())
                          .GetChatClient(m.Model).AsIChatClient(),
    "anthropic"    => new AnthropicClient(m.ApiKey).Messages,                                 // Anthropic.SDK
    _ => throw new InvalidOperationException($"Unknown model provider '{m.Provider}'."),
};
```

API keys come from User Secrets or environment variables — never from the JSON file (same rules as in the [configuration post](/blog/2025/07/09/aspnet-core-configuration-done-right)). Switching from a local model to a cloud one is a config change, which is exactly what you want while comparing models.

### The local-model trap: not every model can call tools

My first host defaulted to a popular local **reasoning** model. It answered nicely... and never called a single tool. Tool calling (also called function calling) must be supported by the **model** and by the **runtime serving it**; many local models don't support it, or support it poorly.

| Symptom | Likely cause |
|---|---|
| The model describes what it *would* call, in text | No tool-calling support in this model / runtime |
| It calls tools with invented parameter names | Weak tool-calling ability; try a larger or tool-tuned model |
| It works with a cloud model, not locally | Local model or quantization too small for reliable tool use |

Check the model's capabilities (Ollama shows a "tools" capability), test with your real tools, and keep a cloud model in the config for comparison. Tool use quality varies far more between models than chat quality does.

---

## Loading MCP servers from a config file

The same idea as VS Code's `mcp.json`: a list of servers, stdio or HTTP:

```json
{
  "Servers": {
    "dev-toolbox": { "Type": "stdio", "Command": "C:/tools/DevToolbox.Mcp/DevToolbox.Mcp.exe" },
    "orders":      { "Type": "http",  "Url": "https://orders-mcp.example.com/mcp" }
  }
}
```

```csharp
public sealed record ServerConfig(string Type, string? Command, string[]? Args, string? Url);

static IClientTransport CreateTransport(string name, ServerConfig s) => s.Type switch
{
    "stdio" => new StdioClientTransport(new StdioClientTransportOptions
    {
        Name = name,
        Command = s.Command!,
        Arguments = s.Args ?? [],
    }),
    "http" => new HttpClientTransport(new HttpClientTransportOptions
    {
        Name = name,
        Endpoint = new Uri(s.Url!),
    }),
    _ => throw new InvalidOperationException($"Unknown server type '{s.Type}' for '{name}'."),
};
```

```csharp
var clients = new List<McpClient>();
var tools = new List<AITool>();

foreach (var (name, server) in config.Servers)
{
    try
    {
        var client = await McpClient.CreateAsync(CreateTransport(name, server));
        clients.Add(client);
        tools.AddRange(await client.ListToolsAsync());
        AnsiConsole.MarkupLine($"[green]✓[/] {Markup.Escape(name)}");
    }
    catch (Exception ex)
    {
        // One server down must not stop the assistant
        AnsiConsole.MarkupLine($"[red]✗[/] {Markup.Escape(name)}: {Markup.Escape(ex.Message)}");
    }
}
```

The `try/catch` per server matters in practice: an HTTP server being deployed, or a missing `.exe` on a machine, should give you an assistant with fewer tools — not no assistant at all.

---

## McpClientTool is an AIFunction

This is the elegant part of the .NET stack: an `McpClientTool` returned by `ListToolsAsync` **is** an `AIFunction` from Microsoft.Extensions.AI. No adapter: MCP tools go straight into the chat options.

```csharp
var chatOptions = new ChatOptions
{
    Tools = tools,                   // MCP tools from every server
    ModelId = config.Model.Model,    // some providers need the model id here
};
```

### UseFunctionInvocation: the loop for free

```csharp
IChatClient chat = CreateChatClient(config.Model)
    .AsBuilder()
    .UseFunctionInvocation(configure: f => f.MaximumIterationsPerRequest = 8)
    .Build();
```

`UseFunctionInvocation()` adds the loop from the diagram: when the model's response contains tool calls, it invokes them (through MCP), appends the results, and calls the model again — automatically. The iteration limit stops a confused model from calling tools forever.

---

## The chat loop

```csharp
var history = new List<ChatMessage> { new(ChatRole.System, SystemPrompt) };

AnsiConsole.Write(new FigletText("Malekbenz Assistant").Color(Color.Green));

while (true)
{
    var question = AnsiConsole.Ask<string>("[bold blue]You:[/]");
    if (question is "exit" or "quit") break;

    history.Add(new ChatMessage(ChatRole.User, question));

    var updates = new List<ChatResponseUpdate>();
    AnsiConsole.Markup("[bold green]Assistant:[/] ");

    await foreach (var update in chat.GetStreamingResponseAsync(history, chatOptions))
    {
        Console.Write(update.Text);            // stream the text as it arrives
        updates.Add(update);
    }
    Console.WriteLine();

    history.AddMessages(updates);              // keep the answer (and tool calls/results) in the history
}

foreach (var client in clients)
    await client.DisposeAsync();
```

Three details from real use:

- **Streaming** makes the assistant feel fast, even when a tool call takes two seconds in the middle.
- **`history.AddMessages(updates)`** keeps the tool calls and results in the conversation, so follow-up questions ("and the ones from last month?") work.
- **Escape model output** before using it in Spectre.Console markup (`Markup.Escape`): a `[` in a model's answer is interpreted as markup and can throw. Writing raw text with `Console.Write` avoids the issue.

---

## The system prompt: identity and style — not rules, not security

My first system prompt was 40 lines long: the assistant's name, the business rules (statuses, transitions), id formats, how to format comparisons, and even rules about how to address certain people. Over time I moved most of it out:

| Belongs in the system prompt | Belongs elsewhere |
|---|---|
| Identity ("You are Malekbenz Assistant...") | Business rules → tool descriptions + server enforcement (May post) |
| Tone, language, answer format | Id formats → parameter descriptions |
| "Use tools before answering; say 'I don't know' rather than guessing" | Who the user is and what they may do → **authentication on the server** |

```csharp
const string SystemPrompt = """
    You are Malekbenz Assistant, helping colleagues query orders and customers.
    Always use the available tools to get facts before answering; never invent data.
    If a request is ambiguous, ask one short clarifying question.
    Answer concisely, in the user's language. Show lists as tables.
    """;
```

The last row of that table is important enough to get its own post: a prompt can **say** "only Hélène can approve refunds", but anyone can type "I'm Hélène". Prompts guide behavior; they don't protect anything. That's August's topic.

---

## Many servers: names and too many tools

With several servers, two problems appear:

**Name collisions** — two servers both exposing `search`. Prefix tool names with the server name when you collect them:

```csharp
tools.AddRange((await client.ListToolsAsync()).Select(t => t.WithName($"{name}_{t.Name}")));
```

**Too many tools** — every tool definition is sent to the model with **every** request. Fifty tools mean thousands of tokens before the user's question, and a model that picks the wrong tool more often. Expose only the servers a given assistant needs, and keep each server focused.

---

## Cost and context

Each request sends the **whole history**: system prompt, tool definitions, every message, every tool result. Long sessions get slower and more expensive, and eventually exceed the model's context window.

- **Trim the history**: keep the system prompt and the last N exchanges, or summarize older turns.
- **Keep tool results small** on the server side (summaries, pages, hints — the May post).
- **Log token usage** (`ChatResponse.Usage`) per request: it shows which tools produce bloated results.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Host = model + MCP clients + a tool-calling loop | The model asks, your host executes |
| Code against `IChatClient`, choose the provider in config | Switch between local and cloud models freely |
| Check that the model really supports tool calling | Many local models don't, or do it badly |
| Load servers from config, `try/catch` per server | One broken server doesn't break the assistant |
| `McpClientTool` is an `AIFunction` → `ChatOptions.Tools` | No adapter code |
| `UseFunctionInvocation()` with an iteration limit | The loop for free, without endless calls |
| Stream responses, keep tool calls in the history | Fast feel, working follow-up questions |
| Escape model output in console markup | A `[` can break the UI |
| System prompt for identity and style only | Rules go in tools, security on the server |
| Prefix tool names, limit tool count, trim history | Fewer collisions, fewer tokens, better choices |

>
> ## That's it & see you soon!.
>
