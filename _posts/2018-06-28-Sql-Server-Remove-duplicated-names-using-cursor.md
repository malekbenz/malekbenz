---
layout: post
title: "Sql server how to remove a duplicated names  using cursor"
date: 2018-06-28
author: Malekbenz
comments: true
category: SQL
tags : [ 'SQL']
categories: ['sqlServer']
description: Sql server how to remove a duplicated names  using cursor.
image: /images/sqlservercursor/cover.png
---

## Remove a duplicated rows ?

I have a table that  contains a list of duplicated names and their translation and the number of occurrences, something like this : 

![CMD](/images/sqlservercursor/table01.png){:class="img-responsive" }


So I need to eliminate the extra rows but keeping one, then I come up with this using **cursor**: 

```
DECLARE @CurrentName nvarchar(50)
DECLARE @NextName nvarchar(50)
DECLARE	Names_Cursor CURSOR FOR  

SELECT  Nom   FROM  dbo.NomsOrigine Order by Nom Asc, Nombre DESC

OPEN Names_Cursor;  
FETCH NEXT FROM Names_Cursor INTO @CurrentName 


WHILE @@FETCH_STATUS = 0  
   BEGIN  

      FETCH NEXT FROM Names_Cursor INTO @NextName ;  

		  IF  @CurrentName = @NextName AND @@FETCH_STATUS = 0
		BEGIN
		  
			DELETE FROM dbo.NomsOrigine where current of Names_Cursor
		 END
	 
	  	SET @CurrentName = @NextName  

   END;  
CLOSE Names_Cursor;  
DEALLOCATE Names_Cursor;  


```


And everything is okay :

![CMD](/images/sqlservercursor/table02.png){:class="img-responsive" }


> 
> ## That's it & see you soon!.
> 