---
layout: post
title: "Publish a dotnet web application with IIS"
date: 2017-02-17
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'Asp.Net',  'SPA', 'AngularJs', 'IIS']
categories: ['Asp.Net', 'IIS']
description: Last time we've created SPA Single Page Application  using a dontnet command with dotnet, but how to deploy my application to production on IIS . In this post I'm going to guide you on how to do that.
image: /images/PublishSpaApp/SpaBrowse.png
---

Last time we've created SPA Single Page Application [Create a Single Page Application with dotnet core](/blog/2017-02-15-Create-Single-page-application-with-dotnet-core)  using a dontnet command with dotnet, but how to deploy my application to production on IIS . In this post I'm going to guide you on how to do that. 

## Generate your application:

Run `dotnet publish` from your dev environment to package your application into a self-contained directory that can run on your `IIS` server

```
    $ dotnet publish
    
```

![CMD](/images/PublishSpaApp/DotnetPublish.png){:class="img-responsive" }

You got : 

![CMD](/images/PublishSpaApp/DotnetPublishSuccess.png){:class="img-responsive" }

Create a directory and copy the `publish` directory :

![CMD](/images/PublishSpaApp/SpaCopy.png){:class="img-responsive" }


### Create a website.

Launch `IIS` : 

![CMD](/images/PublishSpaApp/LaunchIIS.png){:class="img-responsive" }

Right Click on `Site` then click `Add website` 

![CMD](/images/PublishSpaApp/Addwebsite.png){:class="img-responsive" }

Name you website `SpaApp` , choose a port `8080`, and select your application path `e:\SpaApplication`:

![CMD](/images/PublishSpaApp/IISWebSiteCreated.png){:class="img-responsive" }

Click OK, make sure that your website is Running.

![CMD](/images/PublishSpaApp/IISWebSiteRunning.png){:class="img-responsive" }

In the browser, navigate to [http://localhost:8080](http://localhost:8080) .

![CMD](/images/PublishSpaApp/SpaBrowse.png){:class="img-responsive" }


>
> ## That's it!.
> 