---
layout: post
title: "Install Nodejs"
date: 2015-12-22
author: Malekbenz
category: NodeJs
tags : CSS Javascript
---
Today We are going to install Nodejs and build a helloWorld application.

## What is Nodejs ? 
Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient.

## How to install Nodejs ?
To install nodejs go to [Nodejs Official website](https://nodejs.org/) and download Nodejs.

![Node js website](/images/nodejs/nodejswebsite.png){:height="450px" width="550px"}


click to install nodejs.

![click next](/images/nodejs/nodejsfs01.png){:height="450px" width="450px"}

click next.

![Next](/images/nodejs/nodejsfs02.png){:height="450px" width="450px"}

click install.

![Install](/images/nodejs/nodejsfs03.png){:height="450px" width="450px"}

click Finish.

![Finish](/images/nodejs/nodejsfs04.png){:height="450px" width="450px"}


Add node to the system path variable.  

![Path](/images/nodejs/nodejsfs05.png){:height="450px" width="450px"}


To confim that if thing is ok lunch the (node js command line) 

![CMD](/images/nodejs/nodejsfs06.01.gif){:height="450px" width="450px"} 

and type 'node --version'  

```javascript
node --version
```

![CMD](/images/nodejs/nodejsfs06.png){:height="450px" width="450px"}

## Work with Nodejs 
    
Create new file 'app.js' and type the code above:  

```javascript
console.log("Hello World: ");
```

run the application: 


```javascript
node app.js
```
Congratulation! your first application is working.


