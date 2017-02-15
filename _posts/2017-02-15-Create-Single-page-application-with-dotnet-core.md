---
layout: post
title: "Create a Single Page Application with dotnet core"
date: 2017-02-15
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'Asp.Net',  'SPA', 'AngularJs']
categories: ['Asp.Net']
description: I've always seeking a simple way to create SPA Single Page Application with dotnet, and after reading a yesterday Steve Sanderson's post on [Building Single Page Applications on ASP.NET Core with JavaScriptServices].
image: /images/AspNetSpaTemplates/DotnetRunBrowser.png
---

I've always seeking a simple way to create SPA Single Page Application with dotnet, and after reading a yesterday Steve Sanderson's post on [Building Single Page Applications on ASP.NET Core with JavaScriptServices](https://blogs.msdn.microsoft.com/webdev/2017/02/14/building-single-page-applications-on-asp-net-core-with-javascriptservices/). let's me share with you how I've done it. 

## Download and Install .NET Core SDK 1.0 RC4   

To verify dotnet & nodejs version run: 

```
    $ dotnet --info
    $ node --version
```

![CMD](/images/AspNetSpaTemplates/DotnetInfo.png){:class="img-responsive" }

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