---
layout: post
title: "Sql server how to remove a duplicated rows"
date: 2019-06-11
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL']
categories: ['sqlServer']
description: Sql server how to remove a duplicated rows.
image: /images/sqlserverduplicaterows/cover.png
---

## Remove a duplicated rows ?

This how to remove a duplicated rows, using **ROW_NUMBER()** : 

![CMD](/images/sqlserverduplicaterows/01.png){:class="img-responsive" }


```
WITH TempTable (ID,rowNumber)
AS
(
	SELECT ID,ROW_NUMBER() OVER(PARTITION by ID ORDER BY ID) 
	AS rowNumber
	FROM CASNOS 
)
--Then delete all Duplicate Rows

DELETE FROM TempTable
WHERE rowNumber > 1 


```


> 
> ## That's it & see you soon!.
> 