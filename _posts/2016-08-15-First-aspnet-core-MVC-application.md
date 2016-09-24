---
layout: post
title: "First Asp.Net Core MVC application"
date: 2016-08-15
author: Malekbenz
comments: true
category: Asp.Net
tags : ['Asp.Net', '.Net', 'WebAPI']
categories: ['Asp.Net', '.Net']
---

This post will guide you to Build a your First MVC application with ASP.NET Core. I also wanted to do this completely on Linux.

In order to install .NET Core on Ubuntu or Linux Mint you can see [Install .Net Core on linux](/blog/2016/08/01/Install-dotnet-core-linux).

If you don't kown how to create a simple web server you can see [Create a First web application with .Net Core ](/blog/2016/08/05/First-web-application-dotnet-core-linux).

## Create .Net Core project

Create a `mvcapp` directory to hold your application.

```javascript
    $ mkdir  mvcapp
    $ cd mvcapp
    $ dotnet new

```

## Add the Kestrel & MVC packages

Update the project.json file to add the Kestrel HTTP server & MVC packages as a dependency:

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


and run `dotnet restore`to restore dependencies that are specified in the project.json.

```
    $ dotnet restore
```

## Update  Program.cs:

Update the code in Program.cs to setup and start the `Web host`:

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


## Create a Controller (C part of MVC):

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

![CMD](/images/aspnet/HomeControllerString.png){:class="img-responsive" :max-width="80%"}

run the app: 

```
    $ dotnet run
```

![CMD](/images/aspnet/404.error.cs.png){:class="img-responsive" :max-width="80%"}

> And `It doesn't work!` we got `404` error, Because the app doesn't know how to `route` a request.   

## Routing 

Routing is used to `map requests` to route `handlers`. Routes are configured when the application starts `Startup.configure`.

ASP.NET Core MVC is built on top of ASP.NET Core’s routing, a powerful URL-mapping component that lets you build applications that have comprehensible and searchable URLs. This enables you to define your application’s URL naming patterns that work well for search engine optimization (SEO) and for link generation, without regard for how the files on your web server are organized. You can define your routes using a convenient route template syntax that supports route value constraints, defaults and optional values.


```csharp
    routes.MapRoute(name: "Default", template: "{controller=Home}/{action=Index}/{id?}");

```

![CMD](/images/aspnet/Startup.routes.png){:class="img-responsive" :max-width="80%"}

run the app again: 

```
    $ dotnet run
```

![CMD](/images/aspnet/run.with.routes.png){:class="img-responsive" :max-width="80%"}

## View (V  part of MVC)
In order to add a `view`, first we must create `views` directory. and under that direcory we add a `directory` foreach `controller`.

So create `Home` directory under `views` and add `index.cshtml` file:      

```csharp
 <!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Document</title>
        </head>
        <body>
            <h1> This is from the view </h1>
            <h1> Thanks </h1>
        </body>
    </html>   

```
![CMD](/images/aspnet/index.cshtml.png){:class="img-responsive" :max-width="80%"}

run the app: 

```
    $ dotnet run
```

![CMD](/images/aspnet/runWithoutCompilationContext.png){:class="img-responsive" :max-width="80%"}

>But it doesn't work! we got `500 Internal Server Error`.

>In order to compile views we must update `project.json` and set `preserveCompilationContext` to `true`: 

```csharp
"preserveCompilationContext": true
```

![CMD](/images/aspnet/preserveCompilationContext.png){:class="img-responsive" :max-width="80%"}

Run the app and everything is okay.

![CMD](/images/aspnet/runwithCompilationContext.png){:class="img-responsive" :max-width="80%"}

## Model (M part of MVC)

Now Create a Direcory `Models` and add `Person.cs` file:

```csharp
    namespace  mvcapp.models
    {
        public class Person
        {
            public int Id { get; set; }
            public string Name { get; set; }
            public string Email { get; set; }

        }
    }   
```

![CMD](/images/aspnet/Persone.cs.png){:class="img-responsive" :max-width="80%"}

Update  `HomeController.cs` file: 

```csharp 
using Microsoft.AspNetCore.Mvc;
using mvcapp.models;

namespace mvcapp 
{
    public class HomeController:Controller
    {
        public IActionResult Index()
        {
            var person =new Person(){
                Id = 1,
                Name = "Malekbenz",
                Email = "malekbenz@gmail.com"  
            } ;

            return View(person);
        }        
    }
}
```

![CMD](/images/aspnet/HomeControllerModel.png){:class="img-responsive" :max-width="80%"}

Update  `Index.cshtml` file: 

```csharp 
    @model mvcapp.models.Person
    <!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>MVC APP</title>
        </head>
        <body>

            <h1>Welcome to ASP.NET Core MVC</h1>    
            <ul>
                <li>ID: @Model.Id</li>
                <li>Name : @Model.Name</li>
                <li>Email: @Model.Email</li>
                
            </ul>
        </body>
    </html>
```

![CMD](/images/aspnet/IndexWithModel.png){:class="img-responsive" :max-width="80%"}

run the app: 

```
    $ dotnet run
```

![CMD](/images/aspnet/runwithModel.png){:class="img-responsive" :max-width="80%"}

>
> ## ASP.Net Core MVC application.
>