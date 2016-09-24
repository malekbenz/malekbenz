---
layout: post
title: "First web application with ExpressJs"
date: 2016-02-02
author: Malekbenz
comments: true
category: NodeJs
tags : ['Javascript',  'NodeJs', 'Express']
categories: ['Javascript', 'NodeJs', 'Express']
---

Express is a web application framework for nodejs, It is designed for building web applications and APIs. Express  is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications. Express js is great for creating web application and web API.
So... let's build our first web application with express , `HelloExpress` application. if you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## Install express  


Create a `HelloExpress` directory to hold your application, and make that your working directory

```javascript
$ mkdir  helloexpress
$ cd helloexpress
```
create a file 'app.js'

Now install Express in the `HelloExpress` directory and save it in the dependencies list. For example:

![CMD](/images/helloexpress/cmd.png){:class="img-responsive" :max-width="80%"}

```javascript
$  npm install express
```

![CMD](/images/helloexpress/npm.png){:class="img-responsive" :max-width="80%"}

## HelloExpress example

add the following code to app.js file, We use Visual studio code to edit the file:

```javascript
    var express = require('express');
    var app = express();

    app.get('/', function (req, res) {
    res.send('Hello Express!');
    });

    app.listen(3000, function () {
    console.log('App is listening on port 3000!');
    });
```

![vs code](/images/helloexpress/vscode.png){:class="img-responsive" :max-width="80%"}


## Run the application 
    
Run the application: 

```javascript
    $ node app.js
```

![vs code](/images/helloexpress/launch.png){:class="img-responsive" :max-width="80%"}

The application starts a server and listens on port 3000 for connections. The app responds with “Hello Express!” for requests to the root URL (/) or route. For every other path, it will respond with a 404 Not Found.

load [http://localhost:3000/](http://localhost:3000/) in a browser to see the output.

![vs code](/images/helloexpress/web.png){:class="img-responsive" :max-width="80%"}

![vs code](/images/helloexpress/404.png){:class="img-responsive" :max-width="80%"}


>
> ## **Our First Express application is working**
>