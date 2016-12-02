---
layout: post
title: "Step by Setp to create a first angularjs app with visual studio"
date: 2016-12-02
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'javascript',  'angularjs']
categories: ['Asp.Net', 'angularjs']
---

You've always heard about Angularjs, but you don't know how or why to use it ?, so you are in the right place to learn that,  Angularjs is front-end web javascript framework, but how to use it? this is all what this blog is about. 

In this post I am going to guide on how create you first angularjs application using visual studio.


## What is Angularjs? 

Angularjs is javascipt front-end web framework maintained by Google and by a community of individuals and corporations to address many of the challenges encountered in developing single-page applications.


if you don't already have visual studio you can download free version of visual studio [https://www.visualstudio.com/vs/community/](https://www.visualstudio.com/vs/community/).

## Create a empty asp.net project? 

launch visual studio and create a new asp.net application: 

    Click New Project in the Start page or in the File menu.

![CMD](/images/firstAngularApp/newAspApp.png){:class="img-responsive" }

In the New Project dialog, click Web in the left pane and ASP.NET Web Application in the middle pane.

Specify project Name , Location, and other options, and then click OK.

![CMD](/images/firstAngularApp/EmptywebApp.png){:class="img-responsive" }

The New ASP.NET Project dialog appears Click a empty template , and then click OK.

![CMD](/images/firstAngularApp/AddHtmlPage.png){:class="img-responsive" }



![CMD](/images/firstAngularApp/index.html.png){:class="img-responsive" }

![CMD](/images/firstAngularApp/angularjs.org.png){:class="img-responsive" }

![CMD](/images/firstAngularApp/angularjs.download.png){:class="img-responsive" }

```
    
     
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

Now what about Deployment, it's exactly what we are going to do, first  Create new Github repository :

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

You can get see the blog on [https://malektrainer.github.io/](https://malektrainer.github.io/). 

You can find source code  on [https://github.com/malektrainer/myblog](https://github.com/malektrainer/myblog). 


>
> ## Congratulations! You have now created a blog.
>