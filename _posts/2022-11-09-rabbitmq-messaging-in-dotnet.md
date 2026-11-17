---
layout: post
title: "Messaging with RabbitMQ in .NET - Queues, exchanges, acks and dead letters"
date: 2022-11-09
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'RabbitMQ']
categories: ['.Net']
description: 'Messaging with RabbitMQ in .NET - Queues, exchanges, acks and dead letters'
image: /images/covers/rabbitmq-messaging-in-dotnet.png
---

In June we sent order confirmations from a [background service fed by an in-memory Channel](/blog/2022/06/08/aspnet-core-background-services-channels). It made the order request fast — and it lost every queued email on each deployment, because a Channel lives in the app's memory. For work that **must** happen, you need a queue that lives **outside** the app: a **message broker**. RabbitMQ is one of the most used, it's free, and I've used it on both Node.js and .NET projects. Let's build the producer and the consumer in .NET, and spend most of the time on what makes it reliable: durable queues, acknowledgements, idempotency, retries and dead letters.

## The core idea: producer → exchange → queue → consumer

```sql
 Order API                 RabbitMQ                              Workers
┌──────────┐   publish   ┌──────────┐  routing   ┌──────────────┐   consume   ┌────────────┐
│ producer │ ──────────► │ exchange │ ─────────► │ queue: emails │ ──────────► │ consumer 1 │
└──────────┘ "order.     └──────────┘            └──────────────┘ ──────────► │ consumer 2 │
             created"          │                 ┌──────────────┐             └────────────┘
                               └───────────────► │ queue: stock  │ ──► stock worker
                                                 └──────────────┘
```

- The **producer** never sends to a queue directly: it publishes to an **exchange**, with a **routing key** (`order.created`).
- The exchange copies the message to every **queue bound** to it with a matching key.
- **Consumers** read from queues. Several consumers on one queue share the work.
- Messages wait in the queue — on disk if durable — until a consumer confirms it processed them. The API and the workers don't even need to be running at the same time.

> **A broker turns "call this service now and hope it's up" into "leave a message, it will be processed".**

---

## Exchanges: direct, fanout, topic

| Type | Routing | Example |
|---|---|---|
| `direct` | Exact routing key match | `invoice.generate` → the invoices queue |
| `fanout` | To **every** bound queue, key ignored | "cache invalidated" → all instances |
| `topic` | Pattern match on dotted keys: `*` = one word, `#` = zero or more | `order.*` gets `order.created` and `order.cancelled` |

A `topic` exchange is the most flexible default: the emails queue binds to `order.created`, the stock queue to `order.*`, an audit queue to `#`.

---

## Connection and channel

```sql
dotnet add package RabbitMQ.Client
```

```csharp
var factory = new ConnectionFactory
{
    HostName = "localhost",
    UserName = "app",
    Password = builder.Configuration["RabbitMq:Password"],
    DispatchConsumersAsync = true,           // needed for async consumers
};

using var connection = factory.CreateConnection("order-api");   // a TCP connection: expensive
using var channel = connection.CreateModel();                   // a lightweight "virtual connection"
```

| Object | Cost | Share it? |
|---|---|---|
| `IConnection` | A real TCP connection, slow to open | ✅ One per application, as a singleton |
| `IModel` (channel) | Cheap, lives inside the connection | ❌ **Not thread-safe** — one per thread / consumer |

Opening a connection per message is the RabbitMQ version of the `new HttpClient()` mistake. Register the connection once (singleton) and create channels where needed.

### Declaring the topology

```csharp
channel.ExchangeDeclare("orders", ExchangeType.Topic, durable: true);

channel.QueueDeclare("emails", durable: true, exclusive: false, autoDelete: false, arguments: null);
channel.QueueBind("emails", exchange: "orders", routingKey: "order.created");
```

Declarations are **idempotent**: declaring an existing exchange or queue with the same settings does nothing, so both the producer and the consumer can declare what they need at startup. (Declaring it with **different** settings fails — change settings with a new queue name.)

---

## Publishing reliably

```csharp
public sealed record OrderCreated(Guid MessageId, int OrderId, string CustomerEmail, decimal Total);

public sealed class OrderEventsPublisher
{
    private readonly IConnection _connection;
    public OrderEventsPublisher(IConnection connection) => _connection = connection;

    public void PublishOrderCreated(OrderCreated message)
    {
        using var channel = _connection.CreateModel();
        channel.ConfirmSelect();                                     // enable publisher confirms

        var props = channel.CreateBasicProperties();
        props.Persistent = true;                                     // written to disk
        props.ContentType = "application/json";
        props.MessageId = message.MessageId.ToString();

        var body = JsonSerializer.SerializeToUtf8Bytes(message);
        channel.BasicPublish(exchange: "orders", routingKey: "order.created", basicProperties: props, body: body);

        channel.WaitForConfirmsOrDie(TimeSpan.FromSeconds(5));       // the broker has it, or throw
    }
}
```

Three settings make a message survive a broker restart:

```sql
durable exchange + durable queue + persistent message   → survives a RabbitMQ restart
publisher confirms                                       → you KNOW the broker stored it
```

Without confirms, `BasicPublish` returns immediately — if the broker is restarting at that moment, the message is lost and you don't know.

(For production clusters, RabbitMQ's **quorum queues** — `arguments: { ["x-queue-type"] = "quorum" }` — replicate the queue across nodes. Same code otherwise.)

---

## Consuming in a BackgroundService

```csharp
public sealed class EmailConsumer : BackgroundService
{
    private readonly IConnection _connection;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<EmailConsumer> _logger;
    private IModel? _channel;

    public EmailConsumer(IConnection connection, IServiceScopeFactory scopeFactory, ILogger<EmailConsumer> logger)
    {
        _connection = connection;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _channel = _connection.CreateModel();
        _channel.BasicQos(prefetchSize: 0, prefetchCount: 10, global: false);   // max 10 unacked messages

        var consumer = new AsyncEventingBasicConsumer(_channel);
        consumer.Received += async (_, ea) =>
        {
            try
            {
                var message = JsonSerializer.Deserialize<OrderCreated>(ea.Body.Span)!;

                await using var scope = _scopeFactory.CreateAsyncScope();
                var sender = scope.ServiceProvider.GetRequiredService<IConfirmationSender>();
                await sender.SendAsync(message, stoppingToken);

                _channel.BasicAck(ea.DeliveryTag, multiple: false);            // done: remove from the queue
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process message {MessageId}", ea.BasicProperties.MessageId);
                _channel.BasicNack(ea.DeliveryTag, multiple: false, requeue: false);   // → dead letter (below)
            }
        };

        _channel.BasicConsume(queue: "emails", autoAck: false, consumer: consumer);
        return Task.CompletedTask;
    }

    public override void Dispose()
    {
        _channel?.Close();
        base.Dispose();
    }
}
```

The same patterns as in the background services post: one **scope per message**, a `try/catch` around each message.

---

## Acknowledgements: at-least-once delivery

`autoAck: false` is the most important argument in this post. It means: **the message stays in the queue until I say I'm done**.

```sql
autoAck: true   → RabbitMQ deletes the message as soon as it's delivered
                  → the consumer crashes while sending the email → message LOST
autoAck: false  → deleted only after BasicAck
                  → the consumer crashes → the message is delivered again to another consumer
```

| Call | Meaning |
|---|---|
| `BasicAck(tag)` | Processed — delete it |
| `BasicNack(tag, requeue: true)` | Failed — put it back in the queue (immediately!) |
| `BasicNack(tag, requeue: false)` | Failed — drop it, or send it to the dead letter exchange if configured |

Be careful with `requeue: true` on a message that **always** fails (bad data): it comes back instantly, fails again, forever — a "poison message" loop at 100% CPU.

---

## Idempotent consumers

With manual acks, RabbitMQ guarantees **at-least-once** delivery — not exactly-once. If the consumer sends the email and crashes **before** `BasicAck`, the message is delivered again: the customer gets two emails.

The consumer must be **idempotent**: processing the same message twice has the same effect as once. The usual way: remember the message ids you've processed.

```csharp
// Inside the handler, in the same transaction as the work when possible
if (await _db.ProcessedMessages.AnyAsync(m => m.Id == message.MessageId, ct))
    return;                                                    // already done: just ack it

await DoTheWorkAsync(message, ct);
_db.ProcessedMessages.Add(new ProcessedMessage { Id = message.MessageId, ProcessedAt = DateTime.UtcNow });
await _db.SaveChangesAsync(ct);
```

That's why the publisher sets a `MessageId` — a unique id generated **once** per business event.

---

## Prefetch and competing consumers

`BasicQos(prefetchCount: 10)` limits how many unacknowledged messages a consumer holds. Without it, RabbitMQ pushes the **whole queue** to the first consumer that connects — the others stay idle, and the first one holds thousands of messages in memory.

```sql
emails queue ──┬──► consumer A (10 in flight)
               ├──► consumer B (10 in flight)      ← "competing consumers": the work is shared
               └──► consumer C (10 in flight)
```

To process more, run more consumers (more instances of the worker) — no code change. Lower the prefetch for slow messages (1–5), raise it for fast ones (50–100).

---

## Failures: retries and dead letter queues

A failed message shouldn't disappear, and shouldn't loop forever. Configure the queue with a **dead letter exchange**: every message nacked with `requeue: false` (or expired) goes there.

```csharp
channel.ExchangeDeclare("orders.dlx", ExchangeType.Fanout, durable: true);
channel.QueueDeclare("emails.dead", durable: true, exclusive: false, autoDelete: false, arguments: null);
channel.QueueBind("emails.dead", "orders.dlx", routingKey: "");

channel.QueueDeclare("emails", durable: true, exclusive: false, autoDelete: false,
    arguments: new Dictionary<string, object> { ["x-dead-letter-exchange"] = "orders.dlx" });
```

```sql
emails ──(nack, requeue: false)──► orders.dlx ──► emails.dead   ← inspect, fix, replay later
```

For **retries with delay** (the mail server is down for 2 minutes), a common trick uses the same mechanism: nack into a "retry" queue that has a message TTL and dead-letters back into the main exchange:

```sql
emails ──fail──► emails.retry (x-message-ttl: 30000, x-dead-letter-exchange: orders)
                     └── after 30 s ──► back to emails
```

Count attempts with a header (or RabbitMQ's `x-death` header) and send to the dead letter queue after N tries. Monitor the dead letter queue: messages there are work that **didn't happen**.

---

## Saving to the database and publishing

One more trap, on the producer side:

```csharp
await _db.SaveChangesAsync();                // ✅ order saved
_publisher.PublishOrderCreated(message);     // 💥 broker unreachable → no email, ever
```

Or the other order: published, then the database save fails → an email for an order that doesn't exist. The two operations can't be in one transaction. The robust solution is the **outbox pattern**: save the message in an `Outbox` table **in the same transaction** as the order, and let a background job publish pending outbox rows (and mark them sent). Nothing is lost, and with idempotent consumers, publishing twice is harmless.

---

## Libraries on top

`RabbitMQ.Client` is low-level on purpose: you saw connections, channels, acks and topology. Libraries like **MassTransit** or **NServiceBus** wrap all of it — consumers as classes, retries, dead letters, outbox, serialization — behind a simple API. Learn the raw concepts first (they explain every behavior of those libraries), then use a library for real projects if the team prefers.

---

## Key rules to remember

| Rule | Why |
|---|---|
| Publish to exchanges, consume from queues | Producers don't know who listens |
| `topic` exchanges for flexible routing | `order.*`, `#` |
| One connection per app, one channel per thread/consumer | Connections are expensive, channels aren't thread-safe |
| Durable exchange + durable queue + persistent message + confirms | Messages survive restarts, and you know they're stored |
| `autoAck: false`, ack after the work is done | A crash doesn't lose the message |
| Consumers must be idempotent (MessageId) | At-least-once means duplicates happen |
| Set a prefetch (`BasicQos`) | Fair work sharing, bounded memory |
| Never `requeue: true` blindly | Poison messages loop forever |
| Dead letter exchange + monitored DLQ, delayed retries via TTL | Failures are kept, visible and retryable |
| Outbox table for "save + publish" | No lost or phantom messages |

>
> ## That's it & see you soon!.
>
