---
layout: post
title: "Serving static content with Asp.Net Core"
date: 2016-08-10
author: Malekbenz
comments: true
category: Asp.Net
tags : ['Asp.Net', '.Net']
categories: ['Asp.Net', '.Net']
---
## Serving a static contents  

What we are going to do today is Serving a static content without using `Appache`, `nginx` or `IIS`. 

This post will guide you to Build a simple static file server using only the CLI and a text editor. I also wanted to do this completely in Linux.

In order to install .NET Core on Ubuntu or Linux Mint you can see [Install .Net Core on linux](/blog/2016/08/01/Install-dotnet-core-linux).

If you don't kown how to create a simple web server you can see [Create a First web application with .Net Core ](/blog/2016/08/05/First-web-application-dotnet-core-linux).

## Create .Net Core project

Create a `webserver` directory to hold your application, and make that your working directory and then create `wwwroot`

```javascript
    $ mkdir  webserver
    $ cd webserver
    $ mkdir wwwroot

```

![CMD](/images/dotnet/webserver01.png){:class="img-responsive" :max-width="80%"}

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
            "Microsoft.AspNetCore.Server.Kestrel": "1.0.0",
            "Microsoft.AspNetCore.StaticFiles" : "1.0.0"
        },
        "imports": "dnxcore50"
        }
    }
    }
```
![CMD](/images/dotnet/webserverproject.png){:class="img-responsive" :max-width="80%"}


and run `dotnet restore`
```
    $ dotnet restore
```

## Update  Program.cs:

Update the code in Program.cs to setup and start the Web host:

```
using System;
using Microsoft.AspNetCore.Hosting;

namespace webserver
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var host = new WebHostBuilder()
                .UseKestrel()
                .UseContentRoot(Directory.GetCurrentDirectory())
                .UseIISIntegration()
                .UseStartup<Startup>()
                .Build();

            host.Run();
        }
    }
}
```

![CMD](/images/dotnet/webserverStartup.png){:class="img-responsive" :max-width="80%"}

## Configure a static files Middleware:

In order for static files to be served, you must configure the Middleware to add static files to the pipeline.

The static file middleware can be configured by adding a dependency on the `Microsoft.AspNetCore.StaticFiles` package to your `project.json` file.


Calling the `UseStaticFiles` extension method from Startup.Configure


```
// Startup.cs
    using System;
    using Microsoft.AspNetCore.Builder;
    using Microsoft.AspNetCore.Hosting;
    using Microsoft.AspNetCore.Http;

    namespace webserver
    {
        public class Startup
        {
            public void Configure(IApplicationBuilder app)
            {
                app.UseStaticFiles();
             }
        }
    }
```

`app.UseStaticFiles()` makes the files in `web root` (`wwwroot` by default) servable. 

[(http://localhost:5000/index.html](http://localhost:5000/index.html)

![CMD](/images/dotnet/webserverindex.png){:class="img-responsive" :max-width="80%"}

[(http://localhost:5000/image1.png](http://localhost:5000/image1.png)

![CMD](/images/dotnet/webserverpreview.png){:class="img-responsive" :max-width="80%"}



>
> ##  Any files under the `wwwroot` folder will be server 
>

>
> ## **This is your static content web server working **
>