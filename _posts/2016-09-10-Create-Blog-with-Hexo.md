---
layout: post
title: "Create your blog with hexo"
date: 2016-09-10
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'nodejs', 'hexo', 'Github']
categories: ['Asp.Net', '.Net']
---

If you’ve ever wondered how to start a blog, you’re in luck because that’s exactly what I’m going to show you today. Starting your own blog doesn’t have to be complicated or difficult. In fact, more and more people are starting blogs every day. It seems that just about every person or business has 
a blog these days.

I am going to show you exactly how to start a blog with the `hexo`, which can be used from any computer, tablet, or smartphone. In this post  I am going to show you EXACTLY how to create a blog so that you get the most out of it.


## What is Hexo? 

Hexo is a fast, simple and powerful blog framework. You write posts in Markdown (or other languages) and Hexo generates static files with a beautiful theme in seconds.

Installing Hexo is quite easy. However, you do need to have `Nodejs` & `Git` installed first.

In order to install `Nodejs` you can see [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).

In order to install `Git` you can see [https://git-scm.com/ ](https://git-scm.com/).

## Install Hexo? 

Once all the requirements are installed, you can install Hexo.

```
    $ npm install -g hexo-cli
     
```


![CMD](/images/hexo/hexo-version.png){:class="img-responsive" }

## Create a blog

Now that hexo is installed run the following commands to initialise Hexo project  

```
    $ hexo init myblog
    $ cd myblog
    $ npm install
```

![CMD](/images/hexo/hexo-project.png){:class="img-responsive" }

You can modify site settings in `_config.yml`. for the sake of simplicity we're only modify the `Title` and `author` name .

## Run the Blog 

Run the server:  

```
    $ hexo server     
```

![CMD](/images/hexo/hexo-server.png){:class="img-responsive" }

launch your browser and navigate to  [http://localhost:4000](http://localhost:4000/).

![CMD](/images/hexo/hexo-preview.png){:class="img-responsive" }

Voila your first blog is working.

## Create a new post

Create a new post is very simlpe all what you have to do is :

```
    $ hexo new "My Fist Post with hexo"
 
```

![CMD](/images/hexo/hexo-create-post.png){:class="img-responsive" }

Update the file using `Markdown` language:

```
---
title: My Fist Post with hexo
date: 2016-09-25 20:03:25
tags:
---
This my first post using [Hexo](https://hexo.io/)! 

## First title

### a first subtitile 

    ``` bash
    $ hexo new "My New Post"
    ```

## Second title

More info: [Writing](https://hexo.io/docs/writing.html)

```
 
![CMD](/images/hexo/hexo-content-post.png){:class="img-responsive" }

Run the server again:  

```
    $ hexo server     
```

![CMD](/images/hexo/hexo-preview1.png){:class="img-responsive" }

## Deployment on Github

Now what about Deployment and it's exactly what we are going to do, first  Create new Github repository :

![CMD](/images/hexo/hexo-git-project.png){:class="img-responsive" }

Click `settings` 

![CMD](/images/hexo/hexo-git-project-prop.png){:class="img-responsive" }


![CMD](/images/hexo/hexo-git-pages.png){:class="img-responsive" }

Then install hexo-deployer-git: 

```
$ npm install hexo-deployer-git --save

```

![CMD](/images/hexo/hexo-deployer-git.png){:class="img-responsive" }

Click clone or download button:

![CMD](/images/hexo/hexo-git-clone.png){:class="img-responsive" }

Update `_config.yaml` file :

![CMD](/images/hexo/hexo-git-config.yaml.png){:class="img-responsive" }

It's time for deployement : 

```
    $ hexo deploy

```
![CMD](/images/hexo/hexo-deployer.png){:class="img-responsive" }

To preview launch your browser.

![CMD](/images/hexo/hexo-preview-web.png){:class="img-responsive" }


>
> ## 
>