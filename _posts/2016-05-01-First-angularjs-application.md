---
layout: post
title: "First Angularjs application"
date: 2016-05-01
author: Malekbenz
comments: true
category: Angularjs
tags : ['Javascript', 'NodeJs', 'Angularjs']
categories: ['Javascript',  'NodeJs', 'Angularjs']
---
## Angularjs  

AngularJS JavaScript-based front-end web application framework, it alows you to easily build single-page web applications (SPA). 
 
AngularJS provide a framework for client-side model–view–controller (MVC) and model–view–viewmodel (MVVM) architectures, along with components commonly used in rich Internet applications.

You can [download Visual studio community](https://www.visualstudio.com/en-us/news/vs2013-community-vs.aspx).  

## Create a web application  

With visualstudio `New Project`:  

![CMD](/images/vstudio/vsnewproject.png){:class="img-responsive" :max-width="80%"}

Name you project and click `Ok`. 

![CMD](/images/vstudio/vsnewprojectempty.png){:class="img-responsive" :max-width="80%"}

Select `Empty` and click `Ok`.

```javascript
    $ mkdir  webserver
    $ cd webserver
    $ mkdir www

```
create a file 'app.js'


Select an `Empty` template :

![CMD](/images/vstudio/index.html.png){:class="img-responsive" :max-width="80%"}


![CMD](/images/vstudio/vsnewhtml.png){:class="img-responsive" :max-width="80%"}

Add the following code inside your `body` tag. 

```javascript
    <h1> index.html </h1>
```

![CMD](/images/vstudio/index.html.prev.png){:class="img-responsive" :max-width="80%"}

## Let's type some code 

add the following code to app.js file, We use Visual studio code to edit the file:

```javascript
    var express = require('express');
    var app = express();

    app.use(express.static(__dirname + '/www'));

    app.listen(3000);

```
![vs code](/images/vstudio/vscodestatic.png){:class="img-responsive" :max-width="80%"}

add `index.html` file to `www` folder:

```javascript
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Document</title>
            <link href='/style.css' rel='stylesheet' type='text/css'>
        </head>
        <body>
            <h1> Serving static contents with expressjs app </h1>
            <img src="/image.jpg" alt="image">
        </body>
        </html>

```
![vs code](/images/vstudio/index.html.png){:class="img-responsive" :max-width="80%"}

Add `style.css` file to `www` folder:

```javascript
    h1 {
        background-color: rosybrown
    }
```

![vs code](/images/vstudio/style.css.png){:class="img-responsive" :max-width="80%"}

then Add an image to `www` folder and name it `image.jpg` 

![vs code](/images/vstudio/imagestatic.png){:class="img-responsive" :max-width="80%"}

## Run the application 
    
Run the application: 

```javascript
    $ node app.js
```

![loadl application](/images/vstudio/launch.png){:class="img-responsive" :max-width="80%"}

The application starts a server and listens on port 3000 for connections. The app responds with “Welcome to express api” for requests to the root URL (/) or route. 

load [http://localhost:3000/](http://localhost:3000/) in a browser to see the output.

![vs code](/images/vstudio/webstatic.png){:class="img-responsive" :max-width="80%"}

## Alow contents to be cached

Now our http server is working, let's add some functionalities  like caching :

Modify you app.js file :  

```javascript
    app.use(express.static(__dirname + '/www', { maxAge: 3600000 }));
```

![vs code](/images/vstudio/vscodestaticAge.png){:class="img-responsive" :max-width="80%"}

`max-age property of the Cache-Control header is in milliseconds (3600000 =1 hour)`

Save the file and run th application again 

`To stop the app Ctrl + C`

![vs code](/images/vstudio/webstaticCache.png){:class="img-responsive" :max-width="80%"}


>
> ##  Any files under the `www` folder will be server 
>

>
> ## **This is your static content web server working **
>