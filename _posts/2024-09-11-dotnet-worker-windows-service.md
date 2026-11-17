---
layout: post
title: ".NET worker services as Windows Services - From template to production"
date: 2024-09-11
author: Malekbenz
comments: true
category: .Net
tags : [ '.Net', 'C#', 'Windows']
categories: ['.Net']
description: '.NET worker services as Windows Services - From template to production'
image: /images/covers/dotnet-worker-windows-service.png
---

The import service runs perfectly when you double-click the `.exe`. Installed as a Windows service, it starts... and does nothing: it can't find its `appsettings.json`. Fixed. Then on some machines Windows reports "The service did not respond in a timely fashion" after a reboot. Fixed. Then it can't read the shared folder, because the service account isn't you. I've deployed .NET agents as Windows services on many machines, and each of these lessons cost a support call. .NET makes the service part easy — the traps are around it. Let's go from the Worker template to a service that installs cleanly, logs, restarts on failure and updates without drama.

## The core idea: a console app that Windows starts and stops

A Windows service is just an executable that the **Service Control Manager (SCM)** starts at boot, stops at shutdown, and restarts if you ask it to — with no user logged in and no console window.

```sql
Boot ──► SCM starts MalekbenzImport.exe ──► "I'm running" ──► ... works for weeks ...
Stop ──► SCM sends "stop" ──► the app finishes its work ──► exits
Crash ──► SCM applies the recovery options (restart after 1 min)
```

.NET's generic host already knows how to talk to the SCM: you write a normal worker, add one line, and it becomes a service.

> **The code is 95% a normal .NET worker. The 5% that differs — paths, startup time, account, logs — is where services fail.**

---

## The Worker template + AddWindowsService

```sql
dotnet new worker -n MalekbenzImport
dotnet add MalekbenzImport package Microsoft.Extensions.Hosting.WindowsServices
```

```csharp
// Program.cs
var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "Malekbenz Import Service";
});

builder.Services.AddHostedService<ImportWorker>();

builder.Build().Run();
```

```csharp
public sealed class ImportWorker(ILogger<ImportWorker> logger, IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<IImportJob>().RunAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Import failed, retrying at next tick");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
```

`AddWindowsService` does three things **only when running as a service**: it reports start/stop to the SCM, sets the content root to the application folder, and adds Event Log logging. When you run the `.exe` from a console, it does nothing — the same build works both ways.

---

## Publishing: one self-contained file

```sql
dotnet publish MalekbenzImport -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o C:\Services\MalekbenzImport
```

`--self-contained` includes the .NET runtime: nothing to install on the target machines, and no surprise when someone upgrades (or removes) the shared runtime. `PublishSingleFile` gives you one `MalekbenzImport.exe` plus `appsettings.json`.

---

## Installing the service

With `sc.exe` (note the **space after each `=`** — it's required):

```sql
sc.exe create "Malekbenz Import Service" binPath= "C:\Services\MalekbenzImport\MalekbenzImport.exe" start= delayed-auto
sc.exe description "Malekbenz Import Service" "Imports orders from the central server"
sc.exe failure "Malekbenz Import Service" reset= 86400 actions= restart/60000/restart/60000/restart/300000
sc.exe start "Malekbenz Import Service"
```

Or with PowerShell:

```powershell
New-Service -Name "Malekbenz Import Service" `
            -BinaryPathName "C:\Services\MalekbenzImport\MalekbenzImport.exe" `
            -StartupType Automatic `
            -Description "Imports orders from the central server"
```

Two options worth setting every time:

- **`start= delayed-auto`**: starts the service a little after boot, when the network and other services are ready. Agents that call a server at startup fail much less.
- **Recovery (`sc.exe failure`)**: restart after 1 minute, twice, then after 5 minutes — and reset the failure count every day. Without it, one crash means the service stays stopped until someone notices.

---

## Trap 1: the current directory is System32

A service starts with its current directory set to `C:\Windows\System32`. Any **relative path** — or `Directory.GetCurrentDirectory()` — points there:

```csharp
File.ReadAllText("templates/email.html");                                // ❌ C:\Windows\System32\templates\...
Path.Combine(Directory.GetCurrentDirectory(), "data");                   // ❌ same
```

`AddWindowsService()` fixes the **content root** (so `appsettings.json` is found), but your own paths must use it too:

```csharp
public sealed class Paths(IHostEnvironment env)
{
    public string Templates => Path.Combine(env.ContentRootPath, "templates");     // ✅
    public string Data => Path.Combine(AppContext.BaseDirectory, "data");           // ✅ same folder
}
```

Better still for data the service writes (caches, queues, local databases): use a folder outside the program folder, like `C:\ProgramData\MalekbenzImport`, so updates that replace the program files don't touch the data.

---

## Trap 2: the startup timeout

When Windows starts a service, it waits only about **30 seconds** for the service to report "running". `AddWindowsService` reports it when the host starts — which happens **after** everything in `Program.cs` before `Run()`, and after the synchronous part of each `StartAsync`/`ExecuteAsync`:

```csharp
var builder = Host.CreateApplicationBuilder(args);
await WaitForServerAsync();          // ❌ retries until the server answers... on a machine without network yet
builder.Build().Run();
```

```sql
Windows: "The Malekbenz Import Service service did not respond to the start or control request in a timely fashion."
→ the service is marked as failed, before it even started
```

Rules:

- Nothing slow or blocking **before** `Run()`: no retry loops, no waiting for a server, no big migrations.
- Move that work **into** the worker's `ExecuteAsync`, after the first `await`, where it can retry as long as needed while the service is officially "running".
- Combine it with `delayed-auto` start and the recovery options above.

---

## Trap 3: the service account

The service doesn't run as you. By default, a service created with `sc.exe` runs as **LocalSystem** — the most powerful account on the machine, which is far too much for an import service.

| Account | Local rights | Network identity | Use for |
|---|---|---|---|
| LocalSystem | Full admin | The computer account | Avoid unless really needed |
| **LocalService** | Minimal | Anonymous | Services that only work locally |
| **NetworkService** | Minimal | The computer account (`DOMAIN\MACHINE$`) | Services that call network resources |
| A dedicated domain account / **gMSA** | What you grant | That account | Access to SQL Server, shares — with managed passwords (gMSA) |

```sql
sc.exe config "Malekbenz Import Service" obj= "NT AUTHORITY\NetworkService"
sc.exe config "Malekbenz Import Service" obj= "MYDOMAIN\svc-malekbenzimport$"            # gMSA (no password)
```

Then grant **exactly** what it needs: write access to its data folder, read access to the share, a SQL login with the right roles (with Windows authentication, the login is the service account or the machine account). "Access denied" errors that never happen in your console tests are almost always this.

---

## Configuration and secrets

`appsettings.json` next to the `.exe` works as usual (thanks to the content root). For secrets and per-machine values, **don't** edit the file on each machine — use environment variables:

```powershell
# Machine-level: visible to services after a restart of the service
[Environment]::SetEnvironmentVariable("ConnectionStrings__Shop", "Server=...;Integrated Security=true", "Machine")
```

Or set variables for **this service only**, in the registry: a multi-string value named `Environment` under `HKLM\SYSTEM\CurrentControlSet\Services\Malekbenz Import Service`, one `NAME=value` per line. User Secrets don't apply — they're for developers' machines.

---

## Logging: Event Log and files

A service has no console. `AddWindowsService` adds the **Event Log** provider (Warning and above by default), so failures appear in Windows' Event Viewer under *Application* — where administrators look first.

For the details, add file logging with Serilog (see the [structured logging post](/blog/2024/06/12/structured-logging-dotnet-serilog)), with an **absolute** path based on the content root or `ProgramData` — a relative `logs/` folder would end up in System32:

```json
{ "Name": "File", "Args": { "path": "C:\\ProgramData\\MalekbenzImport\\logs\\import-.json", "rollingInterval": "Day" } }
```

And keep the bootstrap logger + `try/catch` around startup: a service that crashes before logging is configured is the hardest problem to diagnose remotely.

---

## Graceful stop

When the service is stopped (or the machine shuts down), the host cancels `stoppingToken` and waits for workers to finish — up to the host's `ShutdownTimeout` (30 seconds by default in .NET 8). Windows itself also only waits a limited time during a system shutdown.

- Pass `stoppingToken` to every async call, so work stops quickly.
- Keep units of work small and idempotent: an import interrupted halfway should be safe to run again.
- If the service needs more time to finish cleanly, raise `ShutdownTimeout` — but prefer making the work interruptible.

---

## Updating a running service

```powershell
Stop-Service "Malekbenz Import Service"
Copy-Item -Path .\publish\* -Destination C:\Services\MalekbenzImport -Recurse -Force
Start-Service "Malekbenz Import Service"
```

The `.exe` is locked while the service runs, so stopping first is required. On many machines, put this in a script (or an update agent) and keep the previous version's folder to roll back quickly.

---

## Debugging: the same code as a console app

Since `AddWindowsService` is inactive outside the SCM, just run the project from Visual Studio or `dotnet run`: same code, same configuration, with console logs. Reproduce service-only problems by testing what's different — run the console **as the service account** (`runas`), from **another current directory**, and with **slow network** at startup.

---

## Key rules to remember

| Rule | Why |
|---|---|
| A worker + `AddWindowsService()` = a Windows service | Same build runs as console or service |
| Publish self-contained, single file | No runtime to install or break on target machines |
| `start= delayed-auto` + recovery options | Starts after the network, restarts after crashes |
| Never use relative paths or the current directory | A service starts in System32 |
| Writable data in `ProgramData`, not the program folder | Updates don't erase data |
| Nothing slow before `Run()` | Windows waits only ~30 s for the service to start |
| Least-privilege account (NetworkService, gMSA), grant only what's needed | LocalSystem is far too powerful |
| Secrets in machine or service environment variables | No per-machine file edits |
| Event Log for failures + absolute-path file logs | Admins can see what happened |
| Honor `stoppingToken`, keep work idempotent | Clean stops and safe restarts |

>
> ## That's it & see you soon!.
>
