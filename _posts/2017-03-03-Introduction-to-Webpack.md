---
layout: post
title: "Introduction to Webpack 2"
date: 2017-03-03
author: Malekbenz
comments: true
category: Nodejs
tags : [ 'JavaScript',  'Nodejs', 'Wabpack']
categories: ['Nodejs']
description: I've always seeking a simple way to create SPA Single Page Application with dotnet, and after reading a yesterday Steve Sanderson's post on [Building Single Page Applications on ASP.NET Core with JavaScriptServices].
image: /images/AspNetSpaTemplates/DotnetRunBrowser.png
---

I was about creating a new project, and decided to use webpack to manage my dependency, so let's me share with you what I think is the esiest way to learn Webpack, guess what ?... exactly is by creating a simple project, so let's do it.     

- If you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## What is Webpack     

Webpack is a powerful module bundler. A bundle is a JavaScript file that incorporate assets that belong together and should be served to the client in a response to a single file request. A bundle can include JavaScript, CSS styles, HTML, and almost any other kind of file.

Webpack roams over your application source code, looking for import statements, building a dependency graph, and emitting one (or more) bundles. With plugins and rules, Webpack can preprocess and minify different non-JavaScript files such as TypeScript, SASS, and LESS files.

You determine what Webpack does and how it does it with a JavaScript configuration file, webpack.config.js.

###  Entries and outputs

You supply Webpack with one or more `entry` files and let it find and `incorporate the dependencies` that radiate from those entries. The one entry point file in this example is the application's root file, `app/app.js` and the outputs of these files is `bundle.js`  file designated in configuration `webpack.config.js` :

```
    const path = require('path');

    const config = {
    entry: './app/app.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist')
    }
    };

    module.exports = config;

```

This `bundle.js` output is a single JavaScript file that contains the application source and its dependencies. You'll load it later with a `script tag` in the index.html


## Sample application     

Create a directory `webpack-intro` 

```
   $ mkdir webpack-intro & cd webpack-intro

```

![CMD](/images/webpack-intro/Project-Initialisation.png){:class="img-responsive" }

Create new project and install webpack.

```
   $ npm Init -y 
   $ npm install --save-dev webpack

```

![CMD](/images/webpack-intro/Webpack-Installation.png){:class="img-responsive" }

Now install `Jquery` :

```
   $ npm install --save jquery

```

![CMD](/images/webpack-intro/Jquery-Installation.png){:class="img-responsive" }

Create a subdirectory `app` with an `app.js` file.

```
var $title = "<h1> Welcme to Webpack world </h1>";
var $ul = ($('<ul>'));
for (var index = 1; index <= 10; index++) {
    var $li = '<li> Element #  '+ index +'</li>';
    $($li).appendTo($ul);
}


$('#list')
        .append($title)
        .append($ul);
```

Create  `index.html` and update the file :

```
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Inroduction to Webapack </title>
</head>

<body>
    <div id="list">

    </div>

    <script src="node_modules/jquery/dist/jquery.min.js"></script>
    <script src="app/app.js"></script>
</body>

</html>
```

In this case, there are implicit dependencies between the <script> tags.

index.js depends on `jquery` being included . It is implicit because index.js never declared a need for `Jquery`; it just assumes that a global variable `$` exists.

![/CMD](/images/webpack-intro/index.html.png){:class="img-responsive" }








- To dowload the SDK Installer GO to [.NET Core SDK 1.0 rc4](https://github.com/dotnet/core/blob/master/release-notes/rc4-download.md)

![CMD](/images/AspNetSpaTemplates/DontNetRec4.png){:class="img-responsive" }

### Install .NET Core SDK 1.0 rc4.

![CMD](/images/AspNetSpaTemplates/DotnetRc4Install.png){:class="img-responsive" }

![CMD](/images/AspNetSpaTemplates/DotnetRc4InstallComplete.png){:class="img-responsive" }

### [Node.js](https://nodejs.org/en/)  version 6 or later

> 
> #### - Because we need [Node.js](https://nodejs.org/en/)  version 6 or later I upgraded nodejs
> 

> 
> #### - If you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  
> 


Now run: 

```
    $ dotnet --info
    $ node --version
```

and you should get something like : 
![CMD](/images/AspNetSpaTemplates/DotnetUpgrade.png){:class="img-responsive" }


If you are upgrading like me from a previous version of node, then you will want to update all existing global packages.

```
    $ npm cache clean
    $ npm update -g
```

## install the Single Page Application (SPA) templates

To install the Single Page Application (SPA) templates, run the following command:

```
    $ dotnet new --install Microsoft.AspNetCore.SpaTemplates::*
```
![CMD](/images/AspNetSpaTemplates/install.SpaTemplates.png){:class="img-responsive" }


You’ll see that dotnet new now can produce projects based on angular, aurelia, knockout, react, and reactredux:

![CMD](/images/AspNetSpaTemplates/install.SpaTemplatesInstalled.png){:class="img-responsive" }

## Create an AngularJs application

To create an AngularJs application Execute the following

```
    $ dotnet new angular
```

First install both the .NET and NPM dependencies. Execute the following:

```
    $ dotnet restore 
    $ npm install
```

Now you can run the application: 

```
    $ dotnet run 
```

![CMD](/images/AspNetSpaTemplates/DotnetRun.png){:class="img-responsive" }

In the browser, navigate to [http://localhost:5000](http://localhost:5000) .

![CMD](/images/AspNetSpaTemplates/DotnetRunBrowser.png){:class="img-responsive" }


>
> ## That's it!.
> 