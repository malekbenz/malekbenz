---
layout: post
title: "Webpack for beginners"
date: 2017-03-03
author: Malekbenz
comments: true
category: Nodejs
tags : [ 'JavaScript',  'Nodejs', 'Wabpack']
categories: ['Nodejs']
description: I was about creating a new project, and decided to use webpack to manage my dependency, so let's me share with you what I think is the esiest way to learn Webpack, guess what ?... Exactly is by creating a simple project, so let's do it.
image: /images/webpack-intro/Presentation.png
---

I was about creating a new project, and decided to use webpack to manage my dependency, so let's me share with you what I think is the esiest way to learn Webpack, guess what ?... Exactly is by creating a simple project, so let's do it.     

- If you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

<script async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
<!-- malekbenz.autobanner -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-5586778286582193"
     data-ad-slot="1751653660"
     data-ad-format="auto"></ins>
<script>
(adsbygoogle = window.adsbygoogle || []).push({});
</script>

## What is Webpack     

Webpack is a powerful module bundler. A bundle is a JavaScript file that incorporate assets that belong together and should be served to the client in a response to a single file request. A bundle can include JavaScript, CSS styles, HTML, and almost any other kind of file.

Webpack roams over your application source code, looking for import statements, building a dependency graph, and emitting one (or more) bundles. With plugins and rules, Webpack can preprocess and minify different non-JavaScript files such as TypeScript, SASS, and LESS files.

![CMD](/images/webpack-intro/webpackimg.png){:class="img-responsive" }

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
   $ npm init -y 
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

In this case, there are implicit dependencies between the `<script> tags`.

`app.js` depends on `jquery` being included . It is implicit because index.js never declared a need for `Jquery`; it just assumes that a global variable `$` exists.

![/CMD](/images/webpack-intro/index.html.png){:class="img-responsive" }

Now run the the app:

![/CMD](/images/webpack-intro/Running01.png){:class="img-responsive" }

As you can see we access to `$title` and `$ul` variable from the console which is bad:

![/CMD](/images/webpack-intro/Running.glablevariable.png){:class="img-responsive" }

## Using Webpack.

Create a `webpack.config.js` file, and update with.

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
Remove `jquery` dependency from `index.html`, replace `app/app.js`  with  `dist/bundle.js`: 

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

    <script src="dist/app.js"></script>
</body>

</html>
```

![/CMD](/images/webpack-intro/index.htmlV2.png){:class="img-responsive" }

Update `app/app.js` using `import $ from jquery`: 

![/CMD](/images/webpack-intro/app.jsV2.png){:class="img-responsive" }

Run the webpack cli :

```
 $ .\node_modules\.bin\webpack app\app.js
```

![/CMD](/images/webpack-intro/webpack.exec.png){:class="img-responsive" }

Now browse your application : 

![/CMD](/images/webpack-intro/Running02.bundle.png){:class="img-responsive" }

Now open you `F12` inspector  and try to access `$title` and `$ul` variable:

![/CMD](/images/webpack-intro/Running.glablevariable2.png){:class="img-responsive" }

## Using webpack with npm

We can set up a little shortcut. By updating `package.json` like this:

```
 "scripts": {
    "build": "webpack"
  }
```

![/CMD](/images/webpack-intro/package.json.png){:class="img-responsive" }

You can now achieve the same as above by using `npm run build` command. npm picks up the scripts through it and patches the environment temporarily so that it contains the bin commands.

![/CMD](/images/webpack-intro/npm.runBuild.png){:class="img-responsive" }


>
> ## That's it see you soon!.
> 
