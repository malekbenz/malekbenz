---
layout: post
title: "First web api application with ExpressJs"
date: 2016-03-01
author: Malekbenz
comments: true
category: NodeJs
tags : CSS Javascript NodeJs ExpressJs
---

Express is a web application framework for nodejs, It is designed for building web applications and APIs.
    
Express  is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications.

Express js is great for creating web application and web API.

So... let's build our first web api application with express , `Helloapi` application. if you didn't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## Install express  


Create a `Helloapi` directory to hold your application, and make that your working directory

```javascript
$ mkdir  Helloapi
$ cd Helloapi
```
create a file 'app.js'

Now install Express in the `Helloapi` directory and save it in the dependencies list. For example:

![CMD](/images/Helloapi/cmd.png){:class="img-responsive" :max-width="80%"}

```javascript
$  npm install express
```

![CMD](/images/Helloapi/npm.png){:class="img-responsive" :max-width="80%"}

## Helloapi example

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

![vs code](/images/Helloapi/vscode.png){:class="img-responsive" :max-width="80%"}


## Run the application 
    
Run the application: 

```javascript
    $ node app.js
```

![vs code](/images/Helloapi/launch.png){:class="img-responsive" :max-width="80%"}

The application starts a server and listens on port 3000 for connections. The app responds with “Hello Express!” for requests to the root URL (/) or route. For every other path, it will respond with a 404 Not Found.

load [http://localhost:3000/](http://localhost:3000/) in a browser to see the output.

![vs code](/images/Helloapi/web.png){:class="img-responsive" :max-width="80%"}

![vs code](/images/Helloapi/404.png){:class="img-responsive" :max-width="80%"}


>
> ## **Our First Express application is working**
>