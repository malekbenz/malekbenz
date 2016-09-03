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

## Add the Kestrel & StaticFiles packages

Update the project.json file to add the Kestrel HTTP server & StaticFiles packages as a dependency:

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

![CMD](/images/dotnet/webserverStartup.png){:class="img-responsive" :max-width="80%"}

run the app: 

```
    $ dotnet run
```

Create `index.html` file and  put some images under `wwwroot` directory:

[http://localhost:5000/index.html](http://localhost:5000/index.html)

![CMD](/images/dotnet/webserverindex.png){:class="img-responsive" :max-width="80%"}

[http://localhost:5000/image1.png](http://localhost:5000/image1.png)

![CMD](/images/dotnet/webserverpreview.png){:class="img-responsive" :max-width="80%"}


Notice that you must specify the name of a file to serve, in order to server a `default` file call the `UseDefaultFiles` extension method from `Startup.Configure` as follows.

```
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

```
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

## Can we serve another direcory contents:

Static files are typically located in the `web root` (`<content-root>/wwwroot`) folder. See Content root and Web root in Introduction to ASP.NET Core for more information. 

### Content root

The `content root` is the base path to any content used by the app, such as its views and web content. By default `content root` == `application base path for the executable hosting` the app.

### Web root

The `web root` of your app is the directory in your project for public, `static resources` like `css`, `js`, and `image` files. The web root path defaults to `<content root>/wwwroot`.
but you can specify a different location using the WebHostBuilder.

To serve another direcory for example `statics` (you must create the directory), then configure the static files middleware as follows :  

```
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

```
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

```

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

```
app.UseFileServer(enableDirectoryBrowsing: true);

```


>
> ## Serve a static content with .NET Core **
>