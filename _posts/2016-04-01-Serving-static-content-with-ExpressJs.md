---
layout: post
title: "Serving static content with ExpressJs"
date: 2016-04-01
author: Malekbenz
comments: true
category: NodeJs
tags : ['Javascript', 'NodeJs', 'Express']
categories: ['Javascript',  'NodeJs', 'webapi', 'Express']
description: What we are going to do today is Serving a static content without using `Appache`, `nginx` or `IIS`. What we need is creating `Http server with expressjs`. This post goes into how this can be achieved.
image: /images/helloexpress/webstaticCache.png
---

What we are going to do today is Serving a static content without using `Apache`, `nginx` or `IIS`. What we need is creating `Http server with expressjs`. This post goes into how this can be achieved. 

if you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## Install express  
`Express` is a nodejs framework that has great built in capabilities to serve static content.  

Create a `webserver` directory to hold your application, and make that your working directory and then create `www`

```javascript
    $ mkdir  webserver
    $ cd webserver
    $ mkdir www

```
create a file 'app.js'

![CMD](/images/helloexpress/cmdstatic.png){:class="img-responsive" :max-width="80%"}

Now install Express in the `webserver` directory and save it in the dependencies list. For example:


```javascript
    $  npm install express
```

![CMD](/images/helloexpress/npm.png){:class="img-responsive" :max-width="80%"}

## Let's type some code 

add the following code to app.js file, We use Visual studio code to edit the file:

```javascript
    var express = require('express');
    var app = express();

    app.use(express.static(__dirname + '/www'));

    app.listen(3000);

```
![vs code](/images/helloexpress/vscodestatic.png){:class="img-responsive" :max-width="80%"}

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
![vs code](/images/helloexpress/index.html.png){:class="img-responsive" :max-width="80%"}

Add `style.css` file to `www` folder:

```javascript
    h1 {
        background-color: rosybrown
    }
```

![vs code](/images/helloexpress/style.css.png){:class="img-responsive" :max-width="80%"}

then Add an image to `www` folder and name it `image.jpg` 

![vs code](/images/helloexpress/imagestatic.png){:class="img-responsive" :max-width="80%"}

## Run the application 
    
Run the application: 

```javascript
    $ node app.js
```

![loadl application](/images/helloexpress/launch.png){:class="img-responsive" :max-width="80%"}

The application starts a server and listens on port 3000 for connections. The app responds with “Welcome to express api” for requests to the root URL (/) or route. 

load [http://localhost:3000/](http://localhost:3000/) in a browser to see the output.

![vs code](/images/helloexpress/webstatic.png){:class="img-responsive" :max-width="80%"}

## Alow contents to be cached

Now our http server is working, let's add some functionalities  like caching :

Modify you app.js file :  

```javascript
    app.use(express.static(__dirname + '/www', { maxAge: 3600000 }));
```

![vs code](/images/helloexpress/vscodestaticAge.png){:class="img-responsive" :max-width="80%"}

`max-age property of the Cache-Control header is in milliseconds (3600000 =1 hour)`

Save the file and run th application again 

`To stop the app Ctrl + C`

![vs code](/images/helloexpress/webstaticCache.png){:class="img-responsive" :max-width="80%"}


>
> ##  Any files under the `www` folder will be server 
>

>
> ## **This is your static content web server working **
>