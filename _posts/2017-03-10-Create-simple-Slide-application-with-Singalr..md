---
layout: post
title: "Create a simple Slide application with Singalr"
date: 2017-03-10
author: Malekbenz
comments: true
category: Nodejs
tags : [ 'JavaScript',  'SignalR', 'Asp.net']
categories: ['SignalR']
description: Today tutorial demonstrates how to use ASP.NET SignalR to create a  simple real-time slide application. You will add SignalR to an Empty ASP.NET application and create a Slide application to send slide that we want to display.
image: /images/webpack-intro/Presentation.png
---

Today tutorial demonstrates how to use ASP.NET SignalR to create a  simple `real-time` slide application. You will add SignalR to an Empty ASP.NET application and create a Slide application to send slide that we want to display.

## What is SignalR     

ASP.NET SignalR is a library for ASP.NET developers that simplifies the process of adding `real-time` web functionality to applications. Real-time web functionality is the ability to have server code push content to connected clients instantly as it becomes available, rather than having the server wait for a client to request new data.

SignalR can be used to add any sort of `real-time` web functionality to your ASP.NET application. Any time a user refreshes a web page to see new data, or the page implements long polling to retrieve new data, it is a candidate for using SignalR. Examples include dashboards and monitoring applications, collaborative applications (such as simultaneous editing of documents), job progress updates, and real-time forms.


###  Create new ASP.NET project

In Visual Studio, create a C# ASP.NET application , name it FirstSignalR, and click OK.

![CMD](/images/firstSignalr/newproject.png){:class="img-responsive" }

In the New ASP.NET Project dialog, and select `Empty` project , and click OK.

![CMD](/images/firstSignalr/emptytemplate.png){:class="img-responsive" }

In Solution Explorer, right-click the project, select Manage Nuget package.

![CMD](/images/firstSignalr/addnugget.png){:class="img-responsive" }

Serach for signalR and click install: 

![CMD](/images/firstSignalr/installsignalr.png){:class="img-responsive" }

Click OK.

![CMD](/images/firstSignalr/installsignalrok.png){:class="img-responsive" }

Click Accept.

![CMD](/images/firstSignalr/installsignalraccept.png){:class="img-responsive" }

In Solution Explorer, right-click the project, select Add | New Folder, and add a new folder named Hubs.

![CMD](/images/firstSignalr/folder.hubs.png){:class="img-responsive" }

Right-click the Hubs folder, click Add | New Item.

![CMD](/images/firstSignalr/add.element.png){:class="img-responsive" }

Select the Visual C# | Web | SignalR node in the Installed pane, select SignalR Hub Class (v2) from the center pane, and create a new hub named SlideHub.cs.

![CMD](/images/firstSignalr/add.newhub.png){:class="img-responsive" }









>
> ## That's it see you soon!.
> 