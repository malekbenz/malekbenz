---
layout: post
title: "Git Basics"
date: 2018-02-20
author: Malekbenz
comments: true
category: GIT
tags : [ 'GIT', 'GitHub' ]
categories: ['GIT']
description: Git Basics.
image: /images/gitbasics/cover.png
---


In this toturial we are going to understand some basic git commands by practice. if you don't know Git **(Git is distrubuted version control system)**..

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


> I assume that you have already have Git installed.


## Create new git repository


Let's create a new directory  **learngit**:

```
 $ mkdir learngit
 $ cd learngit

```
then to create a Git repo you type :

```
 $ git init 

```

![CMD](/images/gitbasics/00.jpg){:class="img-responsive" }


You'll get some like this : 

![CMD](/images/gitbasics/01.jpg){:class="img-responsive" }

## Add Changes to the index (Stage) :

Now let's create a file **file.txt** and check the status: 

```
 $ git status 

```
![CMD](/images/gitbasics/02.jpg){:class="img-responsive" }


![CMD](/images/gitbasics/03.jpg){:class="img-responsive" }

To add the file **file.txt** to the index : 
```
 $ git add file.txt 

```

![CMD](/images/gitbasics/04.jpg){:class="img-responsive" }

which give us: 

![CMD](/images/gitbasics/05.jpg){:class="img-responsive" }

## Remove Changes (or file ) from index (Stage) :


To unstages files we can use :

```
 $ git rm --cached file.txt 

```
![CMD](/images/gitbasics/04.jpg){:class="img-responsive" }

Which means that: 

![CMD](/images/gitbasics/03.jpg){:class="img-responsive" }

## Commit changes:
Now to commit our changes let's first stage our file **file.txt** 

```
 $ git add file.txt 
```
To commit type : 

```
 $ git commit -m "My First commit "

```
![CMD](/images/gitbasics/07.jpg){:class="img-responsive" }

Which means that: 

![CMD](/images/gitbasics/08.jpg){:class="img-responsive" }



>
> ## That's it see you soon!.
> 