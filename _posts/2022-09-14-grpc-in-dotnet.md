---
layout: post
title: "gRPC in .NET - Contracts, streaming, errors and when to use it instead of REST"
date: 2022-09-14
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'Asp.Net', 'C#', 'gRPC']
categories: ['.Net', 'Asp.Net']
description: 'gRPC in .NET - Contracts, streaming, errors and when to use it instead of REST'
image: /images/covers/grpc-in-dotnet.png
---

Two of your own services talk to each other thousands of times a minute: an agent on each machine syncs records with a central server. With REST, you write the same DTOs on both sides, guess the JSON property names, and parse strings back into dates. **gRPC** takes a different approach: you write the contract **once** in a `.proto` file, and .NET generates the server base class and a strongly-typed client for you. Messages are binary (small and fast), it runs on HTTP/2, and it supports **streaming** in both directions. I've used it for exactly this kind of agent ↔ server sync. Let's build it step by step — including the 4 MB limit that will hit you on your first file upload.

## The core idea: contract first

```sql
            orders.proto  (the contract, shared)
               │
       ┌───────┴────────┐
       ▼                ▼
  Server (.NET)     Client (.NET, Go, Java, Python...)
  generated base    generated typed client
  class: override   SyncClient.GetChangesAsync(...)
  the methods
```

| | REST + JSON | gRPC |
|---|---|---|
| Contract | Optional (OpenAPI) | Required (`.proto`), code generated from it |
| Format | JSON text | Protobuf binary (smaller, faster to parse) |
| Transport | HTTP/1.1 or 2 | HTTP/2 |
| Streaming | Not really (SSE, WebSockets on the side) | Built in: server, client and bidirectional |
| Browsers | ✅ Native | ⚠️ Needs gRPC-Web |
| Human-readable / curl-friendly | ✅ | ❌ (binary) |

> **gRPC shines between your own services. REST stays the better choice for public APIs and browsers.**

---

## The contract: a .proto file

```protobuf
syntax = "proto3";

option csharp_namespace = "Sync.Contracts";

import "google/protobuf/timestamp.proto";
import "google/protobuf/wrappers.proto";

service RecordSync {
  rpc GetChanges (ChangesRequest) returns (ChangesResponse);       // unary
  rpc Acknowledge (AckRequest) returns (AckResponse);              // unary
  rpc StreamChanges (ChangesRequest) returns (stream Record);      // server streaming
  rpc Upload (stream FileChunk) returns (UploadResult);            // client streaming
}

message ChangesRequest {
  string client_id = 1;
  int64 since_version = 2;
  int32 max_items = 3;
}

message Record {
  int64 id = 1;
  int64 version = 2;
  string name = 3;
  google.protobuf.StringValue notes = 4;             // nullable string
  google.protobuf.Timestamp updated_at = 5;
  repeated string tags = 6;                          // a list
}

message ChangesResponse {
  repeated Record records = 1;
  int64 last_version = 2;
  bool has_more = 3;
}

message AckRequest  { string client_id = 1; int64 version = 2; }
message AckResponse { bool ok = 1; }

message FileChunk    { string file_name = 1; bytes data = 2; }
message UploadResult { int64 size = 1; }
```

Three things that surprise C# developers:

- **Field numbers** (`= 1`, `= 2`) identify fields on the wire, not names. **Never change or reuse a number** once deployed — add new fields with new numbers. That's how old clients and new servers stay compatible.
- **No null for scalars**: an unset `string` is `""`, an unset `int32` is `0`. For "really nullable", use the **wrapper types** (`google.protobuf.StringValue`, `Int32Value`...), which become `string?` / `int?` in C#.
- **Dates**: there's no built-in date type — use `google.protobuf.Timestamp` (converted with `.ToDateTime()` / `Timestamp.FromDateTime(...)`, in **UTC**).

### Generating the code

Add the `.proto` to the server and client projects:

```xml
<!-- Server project -->
<ItemGroup>
  <PackageReference Include="Grpc.AspNetCore" Version="2.*" />
  <Protobuf Include="..\Protos\record_sync.proto" GrpcServices="Server" />
</ItemGroup>

<!-- Client project -->
<ItemGroup>
  <PackageReference Include="Grpc.Net.Client" Version="2.*" />
  <PackageReference Include="Google.Protobuf" Version="3.*" />
  <PackageReference Include="Grpc.Tools" Version="2.*" PrivateAssets="All" />
  <Protobuf Include="..\Protos\record_sync.proto" GrpcServices="Client" />
</ItemGroup>
```

Build, and the C# classes appear (in `obj/`, regenerated on every build). Keep the `.proto` files in **one shared folder** (or a shared contracts project) so both sides always use the same contract.

---

## The server: unary calls

```csharp
public class RecordSyncService : RecordSync.RecordSyncBase
{
    private readonly IRecordRepository _records;

    public RecordSyncService(IRecordRepository records) => _records = records;

    public override async Task<ChangesResponse> GetChanges(ChangesRequest request, ServerCallContext context)
    {
        var max = Math.Clamp(request.MaxItems, 1, 500);
        var changes = await _records.GetChangedSinceAsync(request.SinceVersion, max + 1, context.CancellationToken);

        var response = new ChangesResponse
        {
            HasMore = changes.Count > max,
            LastVersion = changes.Take(max).LastOrDefault()?.Version ?? request.SinceVersion,
        };
        response.Records.AddRange(changes.Take(max).Select(ToMessage));
        return response;
    }

    private static Record ToMessage(RecordEntity e) => new()
    {
        Id = e.Id,
        Version = e.Version,
        Name = e.Name,
        Notes = e.Notes,                                         // string? ↔ StringValue
        UpdatedAt = Timestamp.FromDateTime(DateTime.SpecifyKind(e.UpdatedAt, DateTimeKind.Utc)),
    };
}
```

```csharp
builder.Services.AddGrpc();

var app = builder.Build();
app.MapGrpcService<RecordSyncService>();
```

This is the incremental sync pattern: the client asks "what changed since version N?", gets a **page** of changes plus `has_more`, and asks again until it's up to date. The version can come from a `rowversion` column — same idea as tracking changes for any sync.

`repeated` fields are **read-only collections** in C#: use `.Add(...)` / `.AddRange(...)`, you can't assign a new list.

---

## The client

```csharp
using var channel = GrpcChannel.ForAddress("https://sync.example.com");
var client = new RecordSync.RecordSyncClient(channel);

long since = await LoadLastVersionAsync();
bool hasMore;

do
{
    var response = await client.GetChangesAsync(
        new ChangesRequest { ClientId = clientId, SinceVersion = since, MaxItems = 200 },
        deadline: DateTime.UtcNow.AddSeconds(10));        // always set a deadline

    await ApplyLocallyAsync(response.Records);
    since = response.LastVersion;
    await client.AcknowledgeAsync(new AckRequest { ClientId = clientId, Version = since });
    hasMore = response.HasMore;
}
while (hasMore);
```

A `GrpcChannel` is expensive (it holds the HTTP/2 connection) — **create it once and reuse it**, like `HttpClient`. In ASP.NET Core, register the client with the factory instead:

```csharp
builder.Services.AddGrpcClient<RecordSync.RecordSyncClient>(o =>
    o.Address = new Uri(builder.Configuration["Sync:Url"]!));
```

Then inject `RecordSync.RecordSyncClient` anywhere — the same pooling benefits as the [HttpClientFactory post](/blog/2022/04/13/dotnet-httpclient-factory-typed-clients), and you can add delegating handlers (auth headers) the same way.

**Deadlines** matter: without one, a call to a stuck server waits forever. With `deadline:`, the call fails with `StatusCode.DeadlineExceeded`, and the server's `context.CancellationToken` is cancelled too.

---

## Streaming

### Server streaming: send many results as they come

```csharp
public override async Task StreamChanges(ChangesRequest request, IServerStreamWriter<Record> responseStream,
    ServerCallContext context)
{
    await foreach (var entity in _records.StreamChangedSinceAsync(request.SinceVersion, context.CancellationToken))
    {
        await responseStream.WriteAsync(ToMessage(entity));
    }
}
```

```csharp
using var call = client.StreamChanges(new ChangesRequest { SinceVersion = since });

await foreach (var record in call.ResponseStream.ReadAllAsync(cancellationToken))
{
    await ApplyLocallyAsync(record);
}
```

No paging, no huge response in memory: records flow one by one over the same call.

### Client streaming: uploading a file the right way

The first version of a file upload is usually one message with the whole file in a `bytes` field:

```protobuf
rpc Upload (UploadRequest) returns (UploadReply);    // UploadRequest { bytes content = 1; }
```

It works in tests with small files... then fails in production:

```sql
Status(StatusCode="ResourceExhausted", Detail="Received message larger than max (6291456 vs. 4194304)")
```

gRPC limits a received message to **4 MB by default**. You can raise it (`MaxReceiveMessageSize`), but the real fix is to **stream chunks** — the memory stays small whatever the file size:

```csharp
// Client: send 64 KB chunks
using var call = client.Upload();
var buffer = new byte[64 * 1024];
await using var file = File.OpenRead(path);
int read;
while ((read = await file.ReadAsync(buffer)) > 0)
{
    await call.RequestStream.WriteAsync(new FileChunk
    {
        FileName = Path.GetFileName(path),
        Data = ByteString.CopyFrom(buffer, 0, read),
    });
}
await call.RequestStream.CompleteAsync();
var result = await call;          // UploadResult
```

```csharp
// Server: write chunks as they arrive
public override async Task<UploadResult> Upload(IAsyncStreamReader<FileChunk> requestStream, ServerCallContext context)
{
    FileStream? target = null;
    long size = 0;
    try
    {
        await foreach (var chunk in requestStream.ReadAllAsync(context.CancellationToken))
        {
            target ??= File.Create(Path.Combine(_uploadFolder, Path.GetFileName(chunk.FileName)));
            await target.WriteAsync(chunk.Data.Memory, context.CancellationToken);
            size += chunk.Data.Length;
        }
    }
    finally
    {
        if (target is not null) await target.DisposeAsync();
    }
    return new UploadResult { Size = size };
}
```

(`Path.GetFileName` on the server matters: never trust a file name sent by a client — `../../app.exe` is a valid string.)

---

## Errors: RpcException and status codes

gRPC doesn't use HTTP status codes in your code; it has its own **status codes**. Throw an `RpcException` on the server:

```csharp
if (!IsKnownClient(request.ClientId))
    throw new RpcException(new Status(StatusCode.Unauthenticated, "Unknown client"));

var record = await _records.FindAsync(id) ?? throw new RpcException(new Status(StatusCode.NotFound, $"Record {id} not found"));
```

And catch it on the client:

```csharp
try
{
    await client.GetChangesAsync(request, deadline: DateTime.UtcNow.AddSeconds(10));
}
catch (RpcException ex) when (ex.StatusCode is StatusCode.Unavailable or StatusCode.DeadlineExceeded)
{
    // transient: retry later
}
catch (RpcException ex) when (ex.StatusCode == StatusCode.Unauthenticated)
{
    // re-register or stop: retrying won't help
}
```

| Status code | Meaning | Retry? |
|---|---|---|
| `InvalidArgument` | Bad request data | ❌ |
| `NotFound` | The resource doesn't exist | ❌ |
| `Unauthenticated` / `PermissionDenied` | Not logged in / not allowed | ❌ |
| `ResourceExhausted` | Limits (message size, quota) | ❌ (fix the cause) |
| `DeadlineExceeded` | Took too long | ⚠️ Maybe |
| `Unavailable` | Server down, network issue | ✅ With backoff |
| `Internal` / `Unknown` | Unhandled server error | ⚠️ Investigate |

Unhandled exceptions on the server become `StatusCode.Unknown` with no details (in production) — throw `RpcException` deliberately for expected errors.

---

## Authentication

gRPC in ASP.NET Core uses the normal auth system: `[Authorize]` on the service class or methods, a JWT in the `Authorization` metadata (header), and `context.GetHttpContext().User` to read the user. On the client, pass a header per call or, better, with a delegating handler on the gRPC client factory:

```csharp
var headers = new Metadata { { "Authorization", $"Bearer {token}" } };
await client.GetChangesAsync(request, headers);
```

---

## When to use gRPC

```sql
✅ Service-to-service calls you own on both sides (microservices, agents ↔ central server)
✅ High call volumes, small binary messages, low latency
✅ Streaming: live updates, large result sets, file transfer in chunks
✅ Polyglot systems: one .proto, clients generated for many languages

❌ Public APIs consumed by unknown clients (REST + JSON + OpenAPI is the standard)
❌ Browser front-ends (possible with gRPC-Web and a proxy, but more moving parts)
❌ Infrastructure that doesn't support HTTP/2 end to end (some old proxies and load balancers)
```

---

## Key rules to remember

| Rule | Why |
|---|---|
| The `.proto` is the contract — share one copy | Server and clients are generated from it |
| Never change or reuse field numbers | Old and new versions stay compatible |
| Wrappers (`StringValue`...) for nullable, `Timestamp` (UTC) for dates | Scalars can't be null, there's no date type |
| `repeated` fields: `Add` / `AddRange`, no assignment | Generated collections are read-only |
| Reuse the channel, or use `AddGrpcClient` | Channels hold the HTTP/2 connection |
| Always set a deadline | No call waits forever |
| 4 MB message limit by default → stream large data | Chunks keep memory small, any file size |
| Never trust client file names (`Path.GetFileName`) | Path traversal |
| Throw `RpcException` with the right `StatusCode` | Clients can decide whether to retry |
| gRPC for your services, REST for public APIs and browsers | Each in its strength |

>
> ## That's it & see you soon!.
>
