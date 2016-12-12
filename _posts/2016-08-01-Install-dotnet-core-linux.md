---
layout: post
title: "Install & Run .Net Core on linux" 
date: 2016-08-01
author: Malekbenz
comments: true
category: .Net
tags : ['.Net',  'Asp']
categories: ['.Net',   'Asp']
description: This post shows you hown to Install & Run .Net Core on linux
image: /images/dotnet/run.png
---

In order to install .NET Core on Ubuntu or Linux Mint, we need to first set up the apt-get feed that hosts the package we need.

## Ubuntu 14.04 / Linux Mint 17

``` Javascript
$ sudo sh -c 'echo "deb [arch=amd64] https://apt-mo.trafficmanager.net/repos/dotnet-release/ trusty main" > /etc/apt/sources.list.d/dotnetdev.list'
$ sudo apt-key adv --keyserver apt-mo.trafficmanager.net --recv-keys 417A0893
$ sudo apt-get update

```
## Ubuntu 16.04

``` Javascript
$ sudo sh -c 'echo "deb [arch=amd64] https://apt-mo.trafficmanager.net/repos/dotnet-release/ xenial main" > /etc/apt/sources.list.d/dotnetdev.list'
$ sudo apt-key adv --keyserver apt-mo.trafficmanager.net --recv-keys 417A0893
$ sudo apt-get update

```

## Install .NET Core SDK
note that you Must remove any previous versions of .NET Core from your system.

To install .NET Core on Ubuntu or Linux Mint, simply use apt-get.

``` Javascript

$ sudo apt-get install dotnet-dev-1.0.0-preview2-003121

```
![CMD](/images/dotnet/version.png){:class="img-responsive" :max-width="80%"}

## Create our first app

Let's initialize a sample Hello World application!

``` Javascript

$ mkdir hellodotnet
$ cd hellodotnet
$ dotnet new

```

![CMD](/images/dotnet/hellodotnet.png){:class="img-responsive" :max-width="80%"}

## Run the app

The first command will restore the packages specified in the project.json file, and the second command will run the actual sample:

```
$ dotnet restore
$ dotnet run
```
![CMD](/images/dotnet/run.png){:class="img-responsive" :max-width="80%"}

And you're ready!



>
> ### Congratulations! You now have .NET core running on your machine!
>