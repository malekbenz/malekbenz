---
layout: post
title: "Build A Simple Web API With Expressjs and AngularJS"
date: 2016-09-01
author: Malekbenz
comments: true
category: Asp.Net
tags : ['Nodejs', 'Express', 'WebAPI', 'Angular']
categories: ['Express', 'Nodejs']
description: In this post we will use Expressjs framework to create Web API that return list of student, and we'll consume it using AngularJs.
image: /images/expressapi/app.static.js.png
---

In this post we will use Expressjs framework to create Web API that return list of student, and we'll consume it using AngularJs.

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
 

## Calling the Web API with Angular

We'll add an HTML page that uses `AJAX` to call the web API. We'll use `AngularJS` to make the `AJAX` calls using `$http` module and also to update the page with the results.

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
    <title>Student application Angular Js</title>
</head>

<body ng-app="studentApp">

    <div ng-controller="studentCtrl">
        <div>
            <h2>Students</h2>
            <ul>
                <li ng-repeat="student in students"> {{student.name}} : {{ student.age}} </li>
            </ul>
        </div>
        <div>
            <h2>Search by ID</h2>
            <input type="text" ng-model="id" size="5" />
            <input type="button" value="Search" ng-click="find(id)" />
            <p>{{result}}</p>

        </div>
    </div>

    <script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.5.8/angular.min.js"></script>
    <script src="/studentApp.js"></script>

</body>

</html>

```

![CMD](/images/expressapi/index.angular.png)

Now add  `studentApp.js` file: 

```
var uri = 'api/student/';

var app = angular.module("studentApp", []);

app.controller("studentCtrl", studentCtrl);

function studentCtrl($scope, $http) {

    $http.get(uri).then( getAll, fail);

    $scope.find = find;

    function find(id) {
        $http.get(uri + id).then(getStudent, fail);
    }

    function getAll(result) {
        $scope.students = result.data;
    }

    function getStudent(result) {
        $scope.result = result.data.name + ': ' + result.data.age;
    }

    function fail(error) {
        $scope.result = error.data;
    }

}

```

![CMD](/images/expressapi/studentApp.js.png)

### Getting a List of students

To get a list of students, send an HTTP GET request to "/api/student".

The `$http` `get` function sends an `AJAX` request. For response contains array of `JSON` objects. The `then` function specifies a `callback` that is called if the request succeeds.

```
    $http.get(uri).then( getAll, fail);

    function getAll(result) {
            $scope.students = result.data;
        }

    function fail(error) {
        $scope.result = error.data;
    }
    
```

### Getting a student By ID

To get a `student` by ID, send an`HTTP GET`  request to `/api/student/id`, where id is the `student ID`.

```
    function find(id) {
        $http.get(uri + id).then(getStudent, fail);
    }

    function getStudent(result) {
        $scope.result = result.data.name + ': ' + result.data.age;
    }

    function fail(error) {
        $scope.result = error.data;
    }

```



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

You can get the code source on [https://github.com/malektrainer/webapiExpressAngular](https://github.com/malektrainer/webapiExpressAngular). 

>
> ## Build Student WebAPI Application with Expressjs and AnguarJs.
>