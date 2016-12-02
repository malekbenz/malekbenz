---
layout: post
title: "Step by Setp to create a first angularjs app with visual studio"
date: 2016-12-02
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'javascript',  'angularjs']
categories: ['Asp.Net', 'angularjs']
---

You've always heard about Angularjs, but you don't know how or why to use it ?, so you are in the right place to learn that,  Angularjs is front-end web javascript framework, but how to use it? this is all what this blog is about. 

In this post I am going to guide on how create you first angularjs application using visual studio.

if you don't already have visual studio you can download free version of visual studio [https://www.visualstudio.com/vs/community/](https://www.visualstudio.com/vs/community/).

## What is Angularjs? 

Angularjs is javascipt front-end web framework maintained by Google and by a community of individuals and corporations to address many of the challenges encountered in developing single-page applications.



## Create a empty asp.net project? 

launch visual studio and create a new asp.net application: 

    Click New Project in the Start page or in the File menu.

![CMD](/images/firstAngularApp/newAspApp.png){:class="img-responsive" }

In the New Project dialog, click Web in the left pane and ASP.NET Web Application in the middle pane.

Specify project Name `firstAngularApp`, Location, and other options, and then click OK.

![CMD](/images/firstAngularApp/EmptywebApp.png){:class="img-responsive" }

The New ASP.NET Project dialog appears Click a empty template , and then click OK.

Now create a new folder `app` and add new html page `index.html`:  

![CMD](/images/firstAngularApp/AddHtmlPage.png){:class="img-responsive" }

update `index.html` : 


```
 <!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title></title>
    <meta charset="utf-8" />
</head>
<body ng-app="app">
    <h1>My first Angular js application with visual studio</h1>

</body>

</html>
  
```

![CMD](/images/firstAngularApp/index.html.png){:class="img-responsive" }


## But what about Angularjs :

now it's time for angularjs, first goto [angularjs web site ](https://angularjs.org/)  

![CMD](/images/firstAngularApp/angularjs.org.png){:class="img-responsive" }

Click download angularjs 1 : 

![CMD](/images/firstAngularApp/angularjs.download.png){:class="img-responsive" }

Select `1.5x stable `  and click `download`, and copy `angular.min.js` to the `app` folder 

Update index.html : 
```
<body ng-app="app">
    <h1>My first Angular js application with visual studio</h1>

    <div ng-controller="booksController">
        Select a title: <input type="text" ng-model="title" />
        
        book title is : {{title}}
    </div>

    <script src="app/angular.min.js"></script>
    <script>
        app = angular.module("app",[]);
        app.controller("booksController", fnbooksController);

        function fnbooksController($scope) {
            $scope.title = "Learn angularjs";

        }
    </script>
</body>

```

![CMD](/images/firstAngularApp/index.html.v01.png){:class="img-responsive" }

Run the app and you should get: 

![CMD](/images/firstAngularApp/index.html.v01.preview.png){:class="img-responsive" }

Congratulations for you first angularjs app.


>
> ## Congratulations!.
>