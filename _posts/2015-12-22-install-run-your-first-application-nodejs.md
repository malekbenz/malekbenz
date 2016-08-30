---
layout: post
title: "Install & run your first application Nodejs"
date: 2015-12-22
author: Malekbenz
comments: true
category: NodeJs
tags : 'CSS' 'Javascript' 'NodeJs'
---

Today We are going to install Nodejs and build our first application, of course a HelloWorld application.

## What is Nodejs ? 

Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient.

It means applications are written in JavaScript, and can be run within the Node.js runtime on OS X, Microsoft Windows, and Linux.

## How to install Nodejs ?
To install nodejs go to [Nodejs Official website](https://nodejs.org/) and download Nodejs.

![Node js website](/images/nodejs/nodejswebsite.png){:class="img-responsive" :max-width="80%"}


after that launch the installer.

![click next](/images/nodejs/nodejsfs01.png)

click next.

![Next](/images/nodejs/nodejsfs02.png)

click install.

![Install](/images/nodejs/nodejsfs03.png)

click Finish.


![Finish](/images/nodejs/nodejsfs04.png)


Add node to the system path variable.  


![Path](/images/nodejs/nodejsfs05.png){:class="img-responsive" :max-width="80%"}


To confim that everything is ok, launch the (node.js command line) and type 'node --version'   

![CMD](/images/nodejs/nodejsfs06.01.png) 



```javascript
node --version
```


## Work with Nodejs 
    
Create new file 'app.js' and type the code above:  

```javascript
console.log("Hello World: ");
```

![CMD](/images/nodejs/nodejsfs06.png)


Run the application: 

```javascript
node app.js
```

>
> ## **Congratulation! your first application is working**
>


