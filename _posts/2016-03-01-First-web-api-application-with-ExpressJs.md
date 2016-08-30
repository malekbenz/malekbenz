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

    var persons = [
        { id: '001', name :'malekbenz', mail:'malek@malekbenz.com'   },
        { id: '002', name :'user1', mail:'user1@malekbenz.com'   },
        { id: '003', name :'user2', mail:'user2@malekbenz.com'   },
        { id: '004', name :'user3', mail:'user3@malekbenz.com'   }

        ];
    app.get('/', function (req, res) {
        res.send('Welcome to express api');
    });

    app.get('/persons', function (req, res) {
        res.json(persons);
    });

    app.listen(3000, function () {
    console.log('App is listening on port 3000!');
    });
```

![vs code](/images/Helloapi/vscodeapi.png){:class="img-responsive" :max-width="80%"}


## Run the application 
    
Run the application: 

```javascript
    $ node app.js
```

![loadl application](/images/Helloapi/launch.png){:class="img-responsive" :max-width="80%"}

The application starts a server and listens on port 3000 for connections. The app responds with “Welcome to express api” for requests to the root URL (/) or route. 

load [http://localhost:3000/](http://localhost:3000/persons) in a browser to see the output.

![vs code](/images/Helloapi/webapi.png){:class="img-responsive" :max-width="80%"}



>
> ## **Our First Express application is working**
>