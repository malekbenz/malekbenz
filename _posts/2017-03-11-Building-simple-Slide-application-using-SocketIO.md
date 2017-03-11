---
layout: post
title: "Building a simple Slide application using SocketIO"
date: 2017-03-11
author: Malekbenz
comments: true
category: Nodejs
tags : [ 'JavaScript',  'SocketIO', 'Nodejs']
categories: ['Nodejs']
description: I've wrote a tutorial demonstrates how to use ASP.NET SignalR to create a  simple `real-time` slide application  [Create a simple Slide application with Singalr](/blog/2015/12/22/2017-03-10-Create-simple-Slide-application-with-Singalr). But Today we will see how to do the same thing with `scoketIO` and Nodejs. We will use nodejs to send slide that we want to display.
image: /images/firstSignalr/prensentation.png
---

I've wrote a tutorial demonstrates how to use ASP.NET SignalR to create a  simple `real-time` slide application  [Create a simple Slide application with Singalr](/blog/2015/12/22/2017-03-10-Create-simple-Slide-application-with-Singalr). But Today we will see how to do the same thing with `scoketIO` and Nodejs. We will use nodejs to send slide that we want to display.


if you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## What is SocketIO     

Socket.IO enables real-time bidirectional event-based communication.
It works on every platform, browser or device, focusing equally on reliability and speed.

###  Create new Expressjs project


Create a new folder and name it :

```
 $ mkdir slideapp
 $ cd slideapp
 
```
Initiate a new project: 

```
 $ npm init -y
 
```

![CMD](/images/firstSocketio/newproject.png){:class="img-responsive" }

Install express

```
 $ npm install express --save-dev
 
```

![CMD](/images/firstSocketio/installexpress.png){:class="img-responsive" }

Then install Socket.io

```
 $ npm install socket.io --save-dev
 
```

![CMD](/images/firstSocketio/installSocketio.png){:class="img-responsive" }


###  Create a Server app

Create `app.js` file, and update :

```
    const path = require('path');
    const express = require('express');
    const app = express();
    const http = require('http').Server(app);
    const io = require('socket.io')(http);

    const slideNumber = 10;
    var currentSlide = 0;
    app.use(express.static(path.join(__dirname, 'www')))

    setInterval(function () {
        var slide = currentSlide++ % slideNumber;
        io.emit('showSlide', slide);

    }, 2000)

    http.listen(3000, function () {
        console.log('listening on *:3000');
    });
 
```

![CMD](/images/firstSocketio/app.js.png){:class="img-responsive" }

###  Add index.html (Client)

Create a `index.html` inside a `www`folder and update the `body` content with:   

```
<body>
    <img id='mySlide' width="350px" src="" alt="">

    <script src="/socket.io/socket.io.js"></script>
    <script>
        var img = document.getElementById("mySlide");
        var socket = io();
        socket.on('showSlide', function (slide) {
            img.src = '/images/' + slide + '.jpg';
        });
    </script>
</body>

```

![CMD](/images/firstSocketio/index.html.png){:class="img-responsive" }

> The script file named `/socket.io/socket.io.js` is dynamically generateed at runtime by the socket.io. 

## Run the project

Run the application .

```
    $ node app.js

```

The application starts a server and listens on `port 3000`.

Browse to http://localhost:3000

![CMD](/images/firstSocketio/running1.png){:class="img-responsive" }

Copy the URL from the address line of the browser and use it to open two more browser instances. In each browser instance you will get the same slide and it will changed synchronously in all browser.

And after 5 second

![CMD](/images/firstSocketio/running2.png){:class="img-responsive" }


>
> ## That's it see you soon!.
> 