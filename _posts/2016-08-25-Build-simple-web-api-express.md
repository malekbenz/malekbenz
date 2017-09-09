---
layout: post
title: "Build A Simple Web API With Expressjs and JQuery"
date: 2016-08-25
author: Malekbenz
comments: true
category: Asp.Net
tags : ['Nodejs', 'Express', 'WebAPI', 'JQuery']
categories: ['Express', 'Nodejs']
description: In this post we will use Expressjs framework to create Web API that return list of student, and we'll consume it using JQuery..
image: /images/webapi/index.preview3.png
---

In this post we will use Expressjs framework to create Web API that return list of student, and we'll consume it using JQuery.

In order to install `Nodejs` you can see [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).

In order to install `Express` you can see [First web api application with Express Js](/blog/2016/02/02/First-web-application-with-ExpressJs).

<script async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
<!-- malekbenz.autobanner -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-5586778286582193"
     data-ad-slot="1751653660"
     data-ad-format="auto"></ins>
<script>
(adsbygoogle = window.adsbygoogle || []).push({});
</script>

## Create Express application

Install express: 

```javascript
    $ npm install express
```

### Create Student Web API:

Create app.js file:

```csharp
    var express = require('express');
    var app = express();

    var students = [

        { id: 1, name: "James Soup", age: 21 },
        { id: 2, name: "Humain yo", age: 20 },
        { id: 3, name: "Hammer tomms", age: 22 }
    ];

    app.get('/api/student', function (req, res) {
        res.json(students);
    });

    app.get('/api/student/:id', function (req, res) {
        var id = req.params.id * 1; // convert to number

        var student = students[id - 1];
        if (student) {
            res.json(student);
        }
        else {
            res.status(404).end();
            res.status(404).send('Sorry, we cannot find that student!');
        }
    });
    app.listen(3000, function () {
        console.log('Student Api listening on http://localhost:3000!');
    });
```

![CMD](/images/expressapi/app.js.png)



We create a array that store list of Students.

We defines two `Get` `response` that return Students:

>'app.get('/api/student')' method returns the entire list of students.

>'app.get('/api/student/:id')' method looks up a single student by its id.

That's it! You have a working web API.  Run the app: 

```
$ node app.js

```

Load [http://localhost:3000/student](http://localhost:3000/student) in a browser to see the output.

![CMD](/images/expressapi/getAllstudents.png)

Load [http://localhost:3000/student/1](http://localhost:3000/student/1) in a browser to see the output.

![CMD](/images/expressapi/getFirststudent.png)

We got '404 error'  If the student doesn't exist: 

Load [http://localhost:3000/student/5](http://localhost:3000/student/5) in a browser to see the output.

![CMD](/images/expressapi/404student.png)
 

## Calling the Web API with jQuery

We'll add an HTML page that uses `AJAX` to call the web API. We'll use `jQuery` to make the `AJAX` calls and also to update the page with the results.

But in order to be able to serve our html file we must add `express.static` Middleware let's do it.

### Configure a `express.static` to server `index.html` 

Update the `app.js` file to add `express.static`:

```csharp
    app.use(express.static(__dirname + '/www'));
```

![CMD](/images/expressapi/app.static.js.png)


### Create `index.html` 

Create `www` directory, then add `index.html`:


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


![CMD](/images/expressapi/index.html.png){:class="img-responsive" }


### Running the Application

Run the app: 

```
    $ node app.js
```

Load [http://localhost:3000/](http://localhost:3000/) in a browser to see the output.

![CMD](/images/webapi/index.preview1.png){:class="img-responsive"}

Search for a student with Id 01.

![CMD](/images/webapi/index.preview2.png){:class="img-responsive" }

Search for a student with Id 05.

![CMD](/images/webapi/index.preview3.png){:class="img-responsive"}

You can get the code source on [https://github.com/malektrainer/studentExpressApi](https://github.com/malektrainer/studentExpressApi). 

>
> ## Build Student WebAPI Application with Expressjs and JQuery.
>