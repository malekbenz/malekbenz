---
layout: post
title: "First web application with Nodejs"
date: 2016-01-01
author: Malekbenz
comments: true
category: NodeJs
tags : CSS Javascript NodeJs
comments: true
tags : ['Javascript',  'NodeJs']
categories: ['Javascript',  'NodeJs']
description: Node js is great for creating web application. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient. 
image: /images/helloweb/web.png
---
Node js is great for creating web application. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient.

In this post we are going to build our first web application, a HelloWeb application. if you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## Create my first web application  

Create a folder 'HelloWeb'

```javascript
    $ mkdir  HelloWeb
```
And within a folder create a file 'app.js'


![CMD](/images/helloweb/cmd.png){:class="img-responsive" :max-width="80%"}

We use Visual studio code you can use your editor of choice 

```javascript
    const http = require('http');

    const hostname = '127.0.0.1';
    const port = 3000;

    const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World!\n');
    });

    server.listen(port, hostname, () => {
    console.log('Server running at http://localhost:3000/');
    });
```

![vs code](/images/helloweb/vscode.png){:class="img-responsive" :max-width="80%"}


## Run the application 
    
Run the application  with the following command: 

```javascript
   $ node app.js
```
The app starts a server and listens on port 3000 for connections. The app responds with “Hello World!”.

![vs code](/images/helloweb/launch.png){:class="img-responsive" :max-width="80%"}

load [http://localhost:3000/](http://localhost:3000/) in a browser to see the output.


![vs code](/images/helloweb/web.png){:class="img-responsive" :max-width="80%"}


>
> ## **your First web application with Nodejs is working**
>


