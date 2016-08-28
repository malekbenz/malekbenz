---
layout: post
title: "First web application with Nodejs"
date: 2016-01-01
author: Malekbenz
category: NodeJs
tags : CSS Javascript NodeJs
---
Node js is great for creating web application. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient.

In this post we are going to build our first web application, a HelloWeb application. if you didn't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## Create my first web application  

Create a folder 'HelloWeb'

```javascript
mkdir  HelloWeb
```
and within a folder create a file 'app.js'


![CMD](/images/HelloWeb/cmd.png){:class="img-responsive" :max-width="80%"}

We use Visual studio code you can use you'r editor of choice 

```javascript
    const http = require('http');

    const hostname = '127.0.0.1';
    const port = 3000;

    const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World\n');
    });

    server.listen(port, hostname, () => {
    console.log('Server running at http://localhost:3000/');
    });
```

![vs code](/images/HelloWeb/vscode.png){:class="img-responsive" :max-width="80%"}


## Run the application 
    
Run the application: 

```javascript
    node app.js
```

![vs code](/images/HelloWeb/web.png){:class="img-responsive" :max-width="80%"}

launch your browser of choice and type 'http://localhost:3000/'

>
> ## **Congratulation! your first web application is worm4king**
>


