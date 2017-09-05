---
layout: post
title: "Install Jekyll on Windows with Chocolatey"
date: 2017-09-05
author: Malekbenz
comments: true
category: Jekyll
tags : [ 'Jekyll'  ]
categories: ['Jekyll']
description: Jekyll is a simple, blog-aware, static site generator perfect for personal, project, or organization sites.
image: /images/installJekyll/run.png
---

[Jekyll](https://jekyllrb.com) is a simple, blog-aware, static site generator perfect for personal, project, or organization sites. Think of it like a file-based CMS, without all the complexity. Jekyll takes your content, renders Markdown and Liquid templates, and spits out a complete, static website ready to be served by Apache, Nginx ,IIS  or another web server. Jekyll is the engine behind GitHub Pages, which you can use to host sites right from your GitHub repositories.
 
## Install Chocolatey     

[Chocolatey](https://chocolatey.org) is a package manager for Windows. Chocolatey is is easy to install.

Open a command prompt with Administrator access and Copy the text specific to your command shell

### Install with CMD     

```
 @"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))" && SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"

```

### Install with powershell     

```
Set-ExecutionPolicy AllSigned; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

```

> If you don't see any errors, you are ready to use Chocolatey! Type **choco** .


>
> **NOTE:** For more informations on how to install **Chocolatey**, please see  [Installing Chocolatey](https://chocolatey.org/install). 
> 

##  Install Ruby and Ruby development kit

First you have to install Ruby, Open a command prompt with Administrator access

```
$ choco install ruby -y

```

Close and reopen a command prompt with Administrator access

```
$ choco install ruby2.devkit

```
##  Configure Ruby development kitPermalink 

The development kit did not set the environment path for Ruby so we need to do it.

Open command prompt in `C:\tools\DevKit2`

```
$ ruby dk.rb init

```
Edit the config.yml file and include the path to Ruby `- C:/tools/ruby22`

![config.yml](/images/installJekyll/config.yml.png){:class="img-responsive" }

```
$ gem sources -a http://rubygems.org

```

Execute the following command to set the path

```
$ ruby dk.rb install
```

##  Install jekyll 

First install  bundler

```
$ gem install bundler

```

And then Install jekyll

```
$ gem install jekyll

```
if you use  jekyll-paginate you install it by typing : 

```
$ gem install jekyll-paginate

```

Run jekyll by typing:

```
$ jekyll serve

```
 

The application starts a server and listens on `port 4000`.

Browse to http://localhost:4000


![CMD](/images/installJekyll/run.png){:class="img-responsive" }

>
> ## That's it see you soon!.
> 