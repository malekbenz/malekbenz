---
layout: post
title: "First Asp.Net Core MVC application"
date: 2016-08-10
author: Malekbenz
comments: true
category: Asp.Net
tags : ['Asp.Net', '.Net']
categories: ['Asp.Net', '.Net']
---
## Serving a static contents  


This post will guide you to Build a your First MVC application with ASP.NET Core. I also wanted to do this completely in Linux.

In order to install .NET Core on Ubuntu or Linux Mint you can see [Install .Net Core on linux](/blog/2016/08/01/Install-dotnet-core-linux).

If you don't kown how to create a simple web server you can see [Create a First web application with .Net Core ](/blog/2016/08/05/First-web-application-dotnet-core-linux).

## Create .Net Core project

Create a `mvcapp` directory to hold your application.

```javascript
    $ mkdir  mvcapp
    $ cd mvcapp

```

![CMD](/images/dotnet/webserver01.png){:class="img-responsive" :max-width="80%"}

## Add the Kestrel & StaticFiles packages

Update the project.json file to add the Kestrel HTTP server & StaticFiles packages as a dependency:

```csharp
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
            "Microsoft.AspNetCore.Mvc" : "1.0.0"
        },
        "imports": "dnxcore50"
        }
    }
    }
```

![CMD](/images/aspnet/project.json.png){:class="img-responsive" :max-width="80%"}


and run `dotnet restore`

```
    $ dotnet restore
```

## Update  Program.cs:

Update the code in Program.cs to setup and start the Web host:

```csharp
using System;
using Microsoft.AspNetCore.Hosting;

namespace mvcapp
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var host = new WebHostBuilder()
                .UseKestrel()
                .UseContentRoot(Directory.GetCurrentDirectory())
                .UseStartup<Startup>()
                .Build();

            host.Run();
        }
    }
}
```
![CMD](/images/aspnet/Program.cs.png){:class="img-responsive" :max-width="80%"}


## Create a Conroller :

In order to create a controller, you must create a `Controllers` folder.

Under the `Controllers` folder create `HomeController` file:  

```csharp
using Microsoft.AspNetCore.Mvc;

namespace mvcapp
{
    public class HomeController : Controller
    {
        public string Index()
        {
            return "Helloo From my MVC APP";
        }
    }
}
```

![CMD](/images/aspnet/Startup.Mvc.png){:class="img-responsive" :max-width="80%"}

run the app: 

```
    $ dotnet run
```

![CMD](/images/aspnet/404.error.cs.png){:class="img-responsive" :max-width="80%"}


## Routing 

ASP.NET Core MVC is built on top of ASP.NET Core’s routing, a powerful URL-mapping component that lets you build applications that have comprehensible and searchable URLs. This enables you to define your application’s URL naming patterns that work well for search engine optimization (SEO) and for link generation, without regard for how the files on your web server are organized. You can define your routes using a convenient route template syntax that supports route value constraints, defaults and optional values.

Convention-based routing enables you to globally define the URL formats that your application accepts and how each of those formats maps to a specific action method on given controller. When an incoming request is received, the routing engine parses the URL and matches it to one of the defined URL formats, and then calls the associated controller’s action method.

```
    routes.MapRoute(name: "Default", template: "{controller=Home}/{action=Index}/{id?}");

```
![CMD](/images/aspnet/Startup.routes.png){:class="img-responsive" :max-width="80%"}

run the app again: 

```
    $ dotnet run
```

![CMD](/images/aspnet/run.with.routes.png){:class="img-responsive" :max-width="80%"}








Create `index.html` file and  put some images under `wwwroot` directory:

[http://localhost:5000/index.html](http://localhost:5000/index.html)

![CMD](/images/dotnet/webserverindex.png){:class="img-responsive" :max-width="80%"}

[http://localhost:5000/image1.png](http://localhost:5000/image1.png)

![CMD](/images/dotnet/webserverpreview.png){:class="img-responsive" :max-width="80%"}


Notice that you must specify the name of a file to serve, in order to server a `default` file call the `UseDefaultFiles` extension method from `Startup.Configure` as follows.

```csharp
    public void Configure(IApplicationBuilder app)
        {
            app.UseDefaultFiles();
            app.UseStaticFiles();
        }
```

With `UseDefaultFiles`, requests to a folder will search for:

```
    default.htm
    default.html
    index.htm
    index.html
```

Run the app again 

![CMD](/images/dotnet/webserverdefault.png){:class="img-responsive" :max-width="80%"}


To change the default file name to home.html.

```csharp
    public void Configure(IApplicationBuilder app)
    {
        // Serve home.html default file, if present.
        DefaultFilesOptions options = new DefaultFilesOptions();
        options.DefaultFileNames.Clear();
        options.DefaultFileNames.Add("home.html");
        app.UseDefaultFiles(options);
        app.UseStaticFiles();
    }
```

```
Note: 
        app.UseFileServer();

    is the same as :
        app.UseStaticFiles();
        app.UseDefaultFiles ; 

```

## What about serving other direcories contents:

Static files are typically located in the `web root` (`<content-root>/wwwroot`) folder. See Content root and Web root in Introduction to ASP.NET Core for more information. 

### Content root

The `content root` is the base path to any content used by the app, such as its views and web content. By default `content root` == `application base path for the executable hosting` the app.

### Web root

The `web root` of your app is the directory in your project for public, `static resources` like `css`, `js`, and `image` files. The web root path defaults to `<content root>/wwwroot`.
but you can specify a different location using the WebHostBuilder.

To serve another direcory for example `statics` (you must create the directory), then configure the static files middleware as follows :  

```csharp
public void Configure(IApplicationBuilder app)
{
    app.UseStaticFiles();

    app.UseStaticFiles(new StaticFileOptions()
    {
        FileProvider = new PhysicalFileProvider(
            Path.Combine(Directory.GetCurrentDirectory(), @"static")),
        RequestPath = new PathString("/public")
    });
}
```

A request to `http://localhost:5000/public/test.png` will serve the test.png file.

## Enabling directory browsing

Directory browsing allows the user of your web app to see a list of directories and files within a specified directory. To enable directory browsing, call the `UseDirectoryBrowser` extension method from `Startup.Configure`:

```csharp
public void Configure(IApplicationBuilder app)
{
    app.UseStaticFiles(); // For the wwwroot folder

    app.UseStaticFiles(new StaticFileOptions()
    {
        FileProvider = new PhysicalFileProvider(
            Path.Combine(Directory.GetCurrentDirectory(), @"wwwroot\images")),
        RequestPath = new PathString("/Images")
    });

    app.UseDirectoryBrowser(new DirectoryBrowserOptions()
    {
        FileProvider = new PhysicalFileProvider(
            Path.Combine(Directory.GetCurrentDirectory(), @"wwwroot\images")),
        RequestPath = new PathString("/Images")
    });
}
```

And add required services by calling `AddDirectoryBrowser` extension method from `Startup.ConfigureServices`:

```csharp

public void ConfigureServices(IServiceCollection services)
{
    services.AddDirectoryBrowser();
}
```
![CMD](/images/dotnet/webserverStartBrowseDir.png){:class="img-responsive" :max-width="80%"}

The code above allows `directory browsing` of the `wwwroot/images` direcory using the URL [http://localhost:5000/images](http://localhost:5000/images), with links to each file and direcory:

![CMD](/images/dotnet/webserverbrowsedir.png){:class="img-responsive" :max-width="80%"}


## UseFileServer

You can use `UseFileServer` to enables static files and the default file to be served and allow directory browsing:

```csharp
app.UseFileServer(enableDirectoryBrowsing: true);

```


>
> ## Serve a static content with .NET Core
>