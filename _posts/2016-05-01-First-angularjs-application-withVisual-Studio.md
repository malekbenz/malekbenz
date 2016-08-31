---
layout: post
title: "First Angularjs application with Visual Studio" 
date: 2016-05-01
author: Malekbenz
comments: true
category: Angularjs
tags : ['Javascript', 'NodeJs', 'Angularjs']
categories: ['Javascript',  'NodeJs', 'Angularjs']
---

AngularJS JavaScript-based front-end web application framework, it alows you to easily build single-page web applications (SPA). 
 
AngularJS provide a framework for client-side model–view–controller (MVC) and model–view–viewmodel (MVVM) architectures, along with components commonly used in rich Internet applications. You can [download Visual studio community](https://www.visualstudio.com/en-us/news/vs2013-community-vs.aspx).  

## Create a web application  

With Visual Studio `New Project`:  

![CMD](/images/vstudio/vsnewproject.png){:class="img-responsive" :max-width="80%"}

Name your project and click `Ok`. 

![CMD](/images/vstudio/vsnewprojectempty.png){:class="img-responsive" :max-width="80%"}

Select `Empty` project template and click `Ok`.

![CMD](/images/vstudio/vsnewhtml.png){:class="img-responsive" :max-width="80%"}

Add the following code inside your `body` tag.

```javascript
    <h1> index.html </h1>
```
![CMD](/images/vstudio/index.html.png){:class="img-responsive" :max-width="80%"}

Run a project : 

![CMD](/images/vstudio/index.html.prev.png){:class="img-responsive" :max-width="80%"}

## What about AngularJS   

To install AngularJs you can download from the  [official web site](https://angularjs.org/). OR Right click on a project click `Manage nuGet package`.



![CMD](/images/vstudio/add.angular.png){:class="img-responsive" :max-width="80%"}

Search for angularjs and click install.

![CMD](/images/vstudio/add.angular.nuget.png){:class="img-responsive" :max-width="80%"}

Now add you `angular.js` script to you `index.html`

```javascript
    <script src="Scripts/angular.js"></script>
```

`index.html` : 

```javascript
        <!DOCTYPE html>
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
                <title></title>
            </head>
            <body ng-app="myapp">
                <div ng-controller="mycontroller">
                    <h1>{{message}}</h1>
                </div>

                <script src="Scripts/angular.js"></script>
                <script>
                    var app = angular.module("myapp", []);
                    app.controller("mycontroller", fnController);
                    function fnController($scope) {
                        $scope.message = "Hello From Angularjs App";
                    };
                </script>
            </body>
        </html>

```

`index.html` file should look like :

![vs code](/images/vstudio/angular.First.png){:class="img-responsive" :max-width="80%"}


## Run the application 
    

![vs code](/images/vstudio/angular.First.preview.png){:class="img-responsive" :max-width="80%"}



>
> ## **First angular js application**
>