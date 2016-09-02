---
layout: post
title: "First ASP.NET application with .Net Core on linux" 
date: 2016-08-05
author: Malekbenz
comments: true
category: .Net
tags : ['.Net',  'Asp']
categories: ['.Net',   'Asp']
---


In order to install .NET Core on Ubuntu or Linux Mint you can see [Install .Net Core on linux](/blog/2016/08/01/Install-dotnet-core-linux).


## Create .Net Core project 

Let's Create  HelloASP application 

``` Javascript

$ mkdir helloASP
$ cd hellodASP
$ dotnet new

```

![CMD](/images/dotnet/helloASP.png){:class="img-responsive" :max-width="80%"}

## Add the Kestrel package

Update the project.json file to add the Kestrel HTTP server package as a dependency:

```
    {
    "version": "1.0.0-*",
    "buildOptions": {
        "debugType": "portable",
        "emitEntryPoint": true
    },
    "dependencies": {},
    "frameworks": {
        "netcoreapp1.0": {
        "dependencies": {
            "Microsoft.NETCore.App": {
            "type": "platform",
            "version": "1.0.0"
            },
            "Microsoft.AspNetCore.Server.Kestrel": "1.0.0" 
        },
        "imports": "dnxcore50"
        }
    }
    }
```

![CMD](/images/dotnet/kestrel.png){:class="img-responsive" :max-width="80%"}


And then restore the packages:

```
$ dotnet restore
```

## Startup.cs file:

Add a Startup.cs file that defines the request handling logic:

```
    using System;
    using Microsoft.AspNetCore.Builder;
    using Microsoft.AspNetCore.Hosting;
    using Microsoft.AspNetCore.Http;

    namespace aspnetcoreapp
    {
        public class Startup
        {
            public void Configure(IApplicationBuilder app)
            {
                app.Run(context =>
                {
                    return context.Response.WriteAsync("Hello from ASP.NET Core!");
                });
            }
        }
    }
```
![CMD](/images/dotnet/startup.cs.png){:class="img-responsive" :max-width="80%"}

## Update  Program.cs:

Update the code in Program.cs to setup and start the Web host:

```
using System;
using Microsoft.AspNetCore.Hosting;

namespace aspnetcoreapp
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var host = new WebHostBuilder()
                .UseKestrel()
                .UseStartup<Startup>()
                .Build();

            host.Run();
        }
    }
}
```

![CMD](/images/dotnet/Program.cs.png){:class="img-responsive"}

## Run the app

```
$ dotnet run
```

![CMD](/images/dotnet/dotnetrun.png){:class="img-responsive" :max-width="80%"}

Browse to http://localhost:5000

![CMD](/images/dotnet/browseaspnet.png){:class="img-responsive" :max-width="80%"}

>
> ### Congratulations!
>