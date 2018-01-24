---
layout: post
title: "Reindexing in Elasticsearch "
date: 2018-01-24
author: Malekbenz
comments: true
category: elasticsearch
tags : [ 'elasticsearch' ]
categories: ['elasticsearch']
description: Reindexing in Elasticsearch.
image: /images/reindexingelasticsearch/cover.png
---


In this tutorial I'm going to show you how to index from an existing index in elasticsearch.

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
 
## Create a sample **index**

Let's first create an index  and name it **myindex** with two properties (FirstName and LastName)


```
PUT localhost:9200/myindex
{
 "mappings": {
    "developer": {
    "properties" : {
        "FirstName": { "type" : "text" },
        "LastName": { "type" : "text" }
        }
      }
    }
}


```

![CMD](/images/reindexingelasticsearch/01.png){:class="img-responsive" }

### Indexing documents 

We need to index some documents (sample data ): 

```
POST localhost:9200/myindex/developer
{
        "FirstName": "malek",
        "LastName": "benzemam"
}

```

```
POST localhost:9200/myindex/developer
{
        "FirstName": "cristiano",
        "LastName": "ronaldo"
}
```

```
POST localhost:9200/myindex/developer
{
        "FirstName": "lionel",
        "LastName": "missi"
}

```


![CMD](/images/reindexingelasticsearch/02.png){:class="img-responsive" }

We can confirm by asking our index :

```
GET localhost:9200/myindex/developer/_search

```

![CMD](/images/reindexingelasticsearch/03.png){:class="img-responsive" }

## Create **mynewindex** & index it from **myindex**     

Create an index  and name it **mynewindex** :

```
PUT localhost:9200/mynewindex
{
 "mappings": {
    "developer": {
    "properties" : {
        "FirstName": { "type" : "text" },
        "LastName": { "type" : "text" }
        }
      }
    }
}

```
![CMD](/images/reindexingelasticsearch/04.png){:class="img-responsive" }


Now all we need is to tell elasticsearch to index **mynewindex**  by using **myindex** as it's source: 

```
POST localhost:9200/_reindex
{
  "source": {
    "index": "myindex"
  },
  "dest": {
    "index": "mynewindex"
  }
}
```

![CMD](/images/reindexingelasticsearch/05.png){:class="img-responsive" }

if we ask our index  **mynewindex** :
```
GET localhost:9200/mynewindex/developer/_search

```

![CMD](/images/reindexingelasticsearch/06.png){:class="img-responsive" }



>
> **NOTE:** For more informations , please see  [ElasticSearch website ](https://www.elastic.co/). 
> 

![CMD](/images/reindexingelasticsearch/cover.png){:class="img-responsive" }

>
> ## That's it see you soon!.
> 