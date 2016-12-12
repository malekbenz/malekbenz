---
layout: post
title: "Introduction to Vue.js "
date: 2016-12-02
author: Malekbenz
comments: true
category: Asp.Net
tags : [ 'Javascript',  'Vue.js']
categories: ['Asp.Net', 'Vue.js']
description: If you never heard about Vue.js or use it befor, you are probably thinking, Oh my God! another javascript framework! what the hell is going on, well in fact the first release of Vue is was in 2014.
image: /images/vue.js/index.html.v01.png
---

If you never heard about Vue.js or use it befor, you are probably thinking: Oh my God! another javascript framework! what the hell is going on, well in fact the first release of Vue is was in 2014. 

Vue is light and fast javascript framework, it's easy to learn, focused on the view layer, and is very easy to pick up and integrate with other libraries or existing projects  On the other hand, Vue is also perfectly capable of powering sophisticated Single-Page Applications when used in combination with modern tooling and supporting libraries.

In this post I am going to guide on how use Vue.js based application using visual studio.

if you don't already have visual studio you can download the free version of visual studio [https://www.visualstudio.com/vs/community/](https://www.visualstudio.com/vs/community/).

## What is Vue.js? 

Vue.js is a progressive framework for building user interfaces. Unlike other monolithic frameworks, Vue is designed from the ground up to be incrementally adoptable. The core library is focused on the view layer only, and is very easy to pick up and integrate with other libraries or existing projects. On the other hand, Vue is also perfectly capable of powering sophisticated Single-Page Applications when used in combination with modern tooling and supporting libraries.


## Create a Empty ASP.NET project? 
let's first create an empty web application, launch visual studio and create a new asp.net application: 

- Click New Project in the Start page or in the File menu.

![CMD](/images/firstAngularApp/newAspApp.png){:class="img-responsive" }

- In the New Project dialog, click Web in the left pane and ASP.NET Web Application in the middle pane.

Specify project Name `firstApp`, Location, and other options, and then click OK.

![CMD](/images/firstAngularApp/EmptywebApp.png){:class="img-responsive" }

- The New ASP.NET Project dialog appears Click a empty template , and then click OK.

Now create a new folder `app` and add new html page `index.html`:  

![CMD](/images/firstAngularApp/AddHtmlPage.png){:class="img-responsive" }

update `index.html` : 

```
    <!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <title></title>
        <meta charset="utf-8" />
    </head>
    <body>
        <h1>My first Vue.js application with visual studio</h1>

    </body>

    </html>
  
```

this is a simple web application.

## Install Vue.js :

In order to use `Vue.js` download  `Vue.js` from [https://vuejs.org/v2/guide/installation.html ](https://vuejs.org/v2/guide/installation.html)  and click `Production version` of `vue.js` : 

![CMD](/images/vue.js/vuejs.download.png){:class="img-responsive" }

Copy `vue.min.js` to the `app` folder 

Update index.html : 

```
<body>
    <h1>My first Vuejs application with visual studio</h1>

    <div id="app">
        Select a title: <input type="text" v-model:value="title" />

        book title is : {{title}}
    </div>

    <script src="app/vue.min.js"></script>
    <script>
        app = new Vue({
            el: "#app",
            data: {
                title: "First Vue.js app"
            }
        });
    </script>
</body>

```
you should get something like : 

![CMD](/images/vue.js/index.html.v01.png){:class="img-responsive" }

Run the app and you should see something like: 

![CMD](/images/vue.js/index.html.v01.preview.png){:class="img-responsive" }

click `F12` to get `F12 tool`, in the console pane type:

```
    app.title = "this is a new title"

```
Wow everything is in sync.

## `v-for` directive: 

`v-for` directive is used to iterate over an array or the properties of an object, let's add to our `app` an array of books: 
  
```
    <div id="app">
        Select a title: <input type="text" v-model:value="title" />

        book title is : {{title}}
        <ul>
            <li v-for ="book in books"> {{ book.id}} --  {{book.title}} </li>
        </ul>
    </div>

    <script src="app/vue.min.js"></script>
    <script>
        app = new Vue({
            el: "#app",
            data: {
                title: "First Vue.js app",

                books : [
                { id: 1, title: "Learn asp.net" },
                { id: 2, title: "Learn javascript" },
                { id: 3, title: "Learn angularjs" },
                { id: 4, title: "Learn nodejs" }
                ]
            }
        });
    </script>

```

![CMD](/images/firstAngularApp/index.html.v02.png){:class="img-responsive" }

```
        <ul>
            <li v-for="book in books">  {{ book.id}}   {{book.title}}</li>
        </ul>

```
Run the app: 

![CMD](/images/firstAngularApp/index.html.v02.preview.png){:class="img-responsive" }

## Methods: 

Now let's add some serach functionality using methods property of our `app` object , update `index.html` 

```
       <ul>
            <li v-for ="book in filterByTitle(title)"> {{ book.id}} --  {{book.title}} </li>
        </ul>

```

and the script part by adding new method `filterByTitle` to our  `app` object:  

```
        app = new Vue({
            el: "#app",
            data: {
                title: "First Vue.js app",
                books : [
                { id: 1, title: "Learn asp.net" },
                { id: 2, title: "Learn javascript" },
                { id: 3, title: "Learn angularjs" },
                { id: 4, title: "Learn nodejs" },
                { id: 4, title: "Learn Vue.js" }
                ]
            },
            methods: {
                filterByTitle: function (title) {

                    return this.books.filter(function (el) {
                        
                        return el.title.indexOf(title)>=0;
                    });
                }
            }
        });
        
```


![CMD](/images/vue.js/index.html.v03.png){:class="img-responsive" }

Run the app: 

![CMD](/images/vue.js/index.html.v03.preview.png){:class="img-responsive" }



>
> ## Congratulations!.
>