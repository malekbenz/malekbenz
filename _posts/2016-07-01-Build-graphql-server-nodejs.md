---
layout: post
title: "Build a simple graphql Server with nodejs" 
date: 2016-07-01
author: Malekbenz
comments: true
category: Github
tags : ['html', 'Github', 'website']
categories: ['html',  'NodeJs', 'Angularjs']
---

GraphQL is a data query language and runtime designed and used at Facebook to request and deliver data to mobile and web apps since 2012. 

## Build a simple GraphQL server

If you don't have node js already installed you can [Install & run your first application Nodejs](/blog/2015/12/22/install-run-your-first-application-nodejs).
We start by making a folder for our application: 

``` Javascript
    $ mkidr graph-server
    $ cd graph-server

```
Install `graphql`, `express` and `express-graphql`.

``` Javascript
    $ npm install graphql 
    $ npm install express 
    $ npm install express-graphql

```
![CMD](/images/graph-ql/01.png){:class="img-responsive" :max-width="80%"}

## Create `users.json` Json file for Data 

Create a file and name it `users.json`

``` Javascript
    {
        "1": {
            "id": "1",
            "name": "Malekbenz",
            "email": "malekbenz@gmail.com"
        },
        "2": {
            "id": "2",
            "name": "user",
            "email": "user@email.com"
        },
        "3": {
            "id": "3",
            "name": "otheruser",
            "email": "otheruser@email.com"
        },
        "4": {
            "id": "4",
            "name": "Superuser",
            "email": "superuser@email.com"
        }
    }
```


## Create the Server

Create a file and name it `app.js` 

``` Javascript
    var graphql = require('graphql'),
        graphqlHTTP = require('express-graphql'),
        express = require('express');

// Import the users file
var users = require('./users.json');

// Define the User type. The type of User is GraphQLObjectType

var userType = new graphql.GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: graphql.GraphQLString },
    name: { type: graphql.GraphQLString },
    email: { type: graphql.GraphQLString },
  }
});

// Define the schema with one top-level field, `user`, that
// takes an `id` argument and returns the User with that ID.

var schema = new graphql.GraphQLSchema({
  query: new graphql.GraphQLObjectType({
    name: 'Query',
    fields: {
      user: {
        type: userType,
        // `args` arguments that the `user` query accepts
        args: {
          id: { type: graphql.GraphQLString }
        },
        // The resolve function take `id` argument from above as a key
        // to get the User from `users`
        resolve: function (_, args) {
          return users[args.id];
        }
      }
    }
  })
});

express()
  .use('/graphql', graphqlHTTP({ schema: schema, pretty: true }))
  .listen(3000);

console.log('Server running on http://localhost:3000/graphql');

```
Save the file and run the application 

```
    $ node app.js 
```
The server is running at localhost:3000/graphql. If you navigate to this address you will receive this notice:

```
 {
  "errors": [
    {
      "message": "Must provide query string."
    }
  ]
}
```

This message indicate that we need to provide a query.  


![CMD](/images/github/13.png){:class="img-responsive" :max-width="80%"}




![CMD](/images/github/13.png){:class="img-responsive" :max-width="80%"}


>
> ### This website is available at [https://malektrainer.github.io](https://malektrainer.github.io)
>