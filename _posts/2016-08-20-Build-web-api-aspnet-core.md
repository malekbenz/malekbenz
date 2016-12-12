---
layout: post
title: "Build Web API With Asp.Net Core and JQuery"
date: 2016-08-20
author: Malekbenz
comments: true
category: Asp.Net
tags : ['Asp.Net', '.Net', 'WebAPI', 'JQuery']
categories: ['Asp.Net', '.Net']
description: ASP.NET MVC was designed for creating websites. Throughout the platform are obvious design decisions that indicate the assumed usage, responding to requests from browsers and returning HTML.
image: /images/webapi/index.preview3.png
---

ASP.NET MVC was designed for creating websites. Throughout the platform are obvious design decisions that indicate the assumed usage: responding to requests from browsers and returning HTML.

ASP.NET Web API is a framework that offers the ASP.NET MVC developer a way to write HTTP services. so they could use it to create web services that returned XML, JSON, or other non-HTML formats. 

In this post we will use Asp.NET core to create Web API that return list of student, and we'll consume it using JQuery.

In order to install .NET Core on Ubuntu or Linux Mint you can see [Install .Net Core on linux](/blog/2016/08/01/Install-dotnet-core-linux).

If you don't kown how to create a simple web server you can see [Create a First web application with .Net Core ](/blog/2016/08/05/First-web-application-dotnet-core-linux).

## Create .Net Core project

Create a `dotnet` core application .

```javascript
    $ dotnet new
```

![CMD](/images/webapi/dotnetnew.png){:class="img-responsive" :max-width="80%"}

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

![CMD](/images/webapi/programe.cs.png){:class="img-responsive" :max-width="80%"}


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
![CMD](/images/webapi/programe.cs.png){:class="img-responsive" :max-width="80%"}

## Create a `Student` class (Model):

Create a `Models` folder and Add a `student.cs` file:

```csharp
    namespace mvcapp
    {
        public class Student
        {
            public int Id { get; set; }
            public string Name { get; set; }
            public int Age { get; set; }

        }
    }
```

![CMD](/images/webapi/student.cs.png){:class="img-responsive" :max-width="80%"}

## Create a `Student` Controller:

In order to create a controller, you must create a `Controllers` folder.

Under the `Controllers` folder create `StudentController.cs` file:  

```csharp
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Mvc;

namespace mvcapp
{
    [Route("api/[controller]")]
    public class StudentController : Controller
    {
        Student[] students = new Student[]
             {
            new Student { Id = 1, Name = "James Soup",  Age = 21 },
            new Student { Id = 2, Name = "Humain -yo", Age = 20 },
            new Student { Id = 3, Name = "Hammer" ,Age = 22 }
             };

        //api/student
        [HttpGet]     
        public IEnumerable<Student> GetAll()
        {
            return students;
        }

        //api/student/1
        [HttpGet("{id}")]
        public IActionResult Get(int id)
        {
            var student = students.FirstOrDefault((s) => s.Id == id);
            if (student == null)
            {

                return NotFound();
            }
            return Ok(student);
        }
    }
}
```

![CMD](/images/webapi/ControllerStudent.png){:class="img-responsive" :max-width="80%"}

![CMD](/images/webapi/ControllerStudentbyId.png){:class="img-responsive" :max-width="80%"}

We create a array that store list of Students inside the controller class.

The controller defines two methods that return Students:

>'GetAll' method returns the entire list of students as an 'IEnumerable<student>' type.

>'Get' method looks up a single student by its ID.

That's it! You have a working web API.  Each method on the controller corresponds to one or more URIs, Run the app: 

```
    $ dotnet run
```

![CMD](/images/webapi/getAllstudents.png){:class="img-responsive" :max-width="80%"}

![CMD](/images/webapi/getFirststudent.png){:class="img-responsive" :max-width="80%"}
 
We got '404 error'  If the student doesn't exist: 

![CMD](/images/webapi/404student.png){:class="img-responsive" :max-width="80%"}

 

## Calling the Web API with jQuery

We'll add an HTML page that uses `AJAX` to call the web API. We'll use `jQuery` to make the `AJAX` calls and also to update the page with the results.

But in order to be able to serve our html file we must add `StaticFiles` Middleware let's do it.

### Configure a static files Middleware to server our index.html 

Update the `project.json` file to add `StaticFiles` packages as a dependency:

```csharp
    "Microsoft.AspNetCore.StaticFiles" : "1.0.0"
```

![CMD](/images/webapi/Project.staticFile.png){:class="img-responsive" :max-width="80%"}


Now update the `Startup.Configure` method :

```csharp
    app.UseFileServer();
    app.UseMvc();
```

![CMD](/images/webapi/startupFileServer.png){:class="img-responsive" :max-width="80%"}

### Create `index.html` 

Create `wwwroot` directory, then add `index.html`


```csharp
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Student application</title>
</head>

<body>

    <div>
        <h2>Students</h2>
        <ul id="students" />
    </div>
    <div>
        <h2>Search by ID</h2>
        <input type="text" id="studentId" size="5" />
        <input type="button" value="Search" onclick="find();" />
        <p id="student" />
    </div>
    <script src="http://ajax.aspnetcdn.com/ajax/jQuery/jquery-2.0.3.min.js"></script>
    
    <script>
    var uri = 'api/student';
    $(function () {
      // Send an AJAX request
      $.getJSON(uri)
          .done(function (data) {
            // On success, 'data' contains a list of students.
            $.each(data, function (key, item) {
              // Add a list item for the student.
              $('<li>', { text: formatStudent(item) }).appendTo($('#students'));
            });
          });
    });

    function formatStudent(item) {
      return item.name + ': ' + item.age;
    }

    function find() {
      var id = $('#studentId').val();
      $.getJSON(uri + '/' + id)
          .done(function (data) {
            $('#student').text(formatStudent(data));
          })
          .fail(function (jqXHR, textStatus, err) {
            $('#student').text('We got an error: ' + err);
          });
    }
  </script>
</body>

</html>
```

### Getting a List of students

To get a list of students, send an HTTP GET request to "/api/student".

The `jQuery` `getJSON` function sends an `AJAX` request. For response contains array of `JSON` objects. The `done` function specifies a `callback` that is called if the request succeeds. In the callback, we update the DOM with the student information.

```
   $(function () {
      // Send an AJAX request
      $.getJSON(uri)
          .done(function (data) {
            // On success, 'data' contains a list of students.
            $.each(data, function (key, item) {
              // Add a list item for the student.
              $('<li>', { text: formatStudent(item) }).appendTo($('#students'));
            });
          });
    });

```

### Getting a student By ID

To get a `student` by ID, send an`HTTP GET`  request to `/api/student/id`, where id is the `student ID`.

```
    function find() {
      var id = $('#studentId').val();
      $.getJSON(uri + '/' + id)
          .done(function (data) {
            $('#student').text(formatStudent(data));
          })
          .fail(function (jqXHR, textStatus, err) {
            $('#student').text('We got an error: ' + err);
          });
    }

```

![CMD](/images/webapi/index.html.png){:class="img-responsive" }

![CMD](/images/webapi/index.js.png){:class="img-responsive" }

### Running the Application

Run the app: 

```
    $ dotnet run
```

![CMD](/images/webapi/index.preview1.png){:class="img-responsive"}

![CMD](/images/webapi/index.preview2.png){:class="img-responsive" }

![CMD](/images/webapi/index.preview3.png){:class="img-responsive"}

You can get the code source on [https://github.com/malektrainer/samplewebapi](https://github.com/malektrainer/samplewebapi). 

>
> ## Build ASP.Net Core WebAPI Application.
>