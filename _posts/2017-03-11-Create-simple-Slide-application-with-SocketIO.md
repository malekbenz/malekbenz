---
layout: post
title: "Create a simple Slide application with SocketIO"
date: 2017-03-11
author: Malekbenz
comments: true
category: Nodejs
tags : [ 'JavaScript',  'SocketIO', 'Nodejs']
categories: ['SignalR']
description: Today tutorial demonstrates how to use ASP.NET SignalR to create a  simple real-time slide application. You will add SignalR to an Empty ASP.NET application and create a Slide application to send slide that we want to display.
image: /images/firstSignalr/prensentation.png
---

I've wrote a tutorial demonstrates how to use ASP.NET SignalR to create a  simple `real-time` slide application  [Create a simple Slide application with Singalr](/blog/2015/12/22/2017-03-10-Create-simple-Slide-application-with-Singalr). But Today we will see how to do the same thing with `scoketIO` and Nodejs. We will use nodejs to send slide that we want to display.


if you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).  

## What is SocketIO     

Socket.IO enables real-time bidirectional event-based communication.
It works on every platform, browser or device, focusing equally on reliability and speed.

###  Create new Expressjs project


In Visual Studio, create a C# ASP.NET application , name it FirstSignalR, and click OK.

![CMD](/images/firstSignalr/newproject.png){:class="img-responsive" }

In the New ASP.NET Project dialog, and select `Empty` project , and click OK.

![CMD](/images/firstSignalr/emptytemplate.png){:class="img-responsive" }

###  Install signalR

In Solution Explorer, right-click the project, select Manage Nuget package.

![CMD](/images/firstSignalr/addnugets.png){:class="img-responsive" }

Serach for signalR and click install: 

![CMD](/images/firstSignalr/installsignalr.png){:class="img-responsive" }

Click OK.

![CMD](/images/firstSignalr/installsignalrok.png){:class="img-responsive" }

Click Accept.

![CMD](/images/firstSignalr/installsignalraccept.png){:class="img-responsive" }


In Solution Explorer, right-click the project, select Add => Class.

![CMD](/images/firstSignalr/addStartupclass.png){:class="img-responsive" }

Search for OWIN, name it Startup and click Add.

![CMD](/images/firstSignalr/addOwinStartupclass.png){:class="img-responsive" }

Replace the code in the Configuration methode with the following code.

```
        public void Configuration(IAppBuilder app)
        {
            app.MapSignalR();
        }

```

###  Create the SlideHub class

In Solution Explorer, right-click the project, select Add => New Folder, and add a new folder named Hubs.

![CMD](/images/firstSignalr/folder.hubs.png){:class="img-responsive" }

Right-click the Hubs folder, click Add => New Item.

![CMD](/images/firstSignalr/add.element.png){:class="img-responsive" }

Select the Visual C# => Web => SignalR node in the Installed pane, select SignalR Hub Class (v2) from the center pane, and create a new hub named SlideHub.cs.

![CMD](/images/firstSignalr/add.newhub.png){:class="img-responsive" }

Replace the code in the SlideHub class with the following code.

```
   public class SlideHub : Hub
    {
        static IHubContext mySlideHub;
        static Timer timer;
        static int currentSlide;
        static int slideNumber = 10;

        static SlideHub()
        {
            mySlideHub = GlobalHost.ConnectionManager.GetHubContext<SlideHub>();

            timer = new Timer(5000);
            timer.Elapsed += (sender, e) => showSlide();
            timer.Start();
        }

        static private void showSlide()
        {
            var slide = currentSlide++ % slideNumber;
            mySlideHub.Clients.All.showSlide(slide + ".jpg");
        }
    }

```

>> ### Access to the Hubs from outside of the Hub class 
The Clients dynamic property of the Hub gives you access to all clients connected to the hub within the hub class. However, what if you would like to push data to the clients from outside of the Hub class. This is where the static `GlobalHost` SignalR class comes to rescue. It gives you access to the `HubContext` through the IConnectionManager interface.
The `IHubContext`, which is returned from the `GetHubContext` exposes the dynamic Clients and IGroupManager Groups. This means that you can get access to the clients connected to the hubs from anywhere in your app.


![CMD](/images/firstSignalr/slidehub.png){:class="img-responsive" }

###  Add index.html (Client)

In Solution Explorer, right-click the project, select Add => HTML Page  named index.html.

![CMD](/images/firstSignalr/slidehub.png){:class="img-responsive" }


Replace the code in the Body tage with the following code.

```
<body>
    <img style="width:350px; " src="" />

    <script src="Scripts/jquery-1.6.4.min.js"></script>
    <script src="Scripts/jquery.signalR-2.2.1.min.js"></script>
    <script src="/signalr/hubs"></script>

    <script>
        
        $(function () {
            $img = $("img");
            var slide = $.connection.slideHub;
            slide.client.showSlide = function (slideName) {
                
                $img.attr("src", "images/" + slideName )
            }

            $.connection.hub.start().done(function () {
                console.log("Welcome to slideshow");
            });

        });
    </script>
</body>
```

>The script file named `hubs` is dynamically generateed at runtime by the SignalR library . This file manages the communication between jQuery script and server-side code. you can also access the dynamic hubs file by browsing to it directly, for example http://firstsignalr/signalr/hubs.

## Run the project

Press F5 to run the project.

Copy the URL from the address line of the browser and use it to open two more browser instances. In each browser instance you will get the same slide and it will changed synchronously in all browser.

![CMD](/images/firstSignalr/running.png){:class="img-responsive" }

And after 5 second

![CMD](/images/firstSignalr/running1.png){:class="img-responsive" }


>
> ## That's it see you soon!.
> 