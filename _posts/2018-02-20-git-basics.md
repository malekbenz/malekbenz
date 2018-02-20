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


Right click on it and select properties: 

![CMD](/images/sqltruncatelog/02.png){:class="img-responsive" }

Go to the **options** and change the  recovery model to **simple** and click ok.

![CMD](/images/sqltruncatelog/03.png){:class="img-responsive" }

Now let's truncate the **log file**  to section Tasks -> Shrink -> Files.

![CMD](/images/sqltruncatelog/04.png){:class="img-responsive" }

 In File type select Log and click ok.

![CMD](/images/sqltruncatelog/05.png){:class="img-responsive" }

Now you can check the size of your file

![CMD](/images/sqltruncatelog/06.png){:class="img-responsive" }




### Using Transact SQL

You can you achieve the same results using **Trasact SQL** script :

```
  DECLARE @SQL nvarchar(100)
  DECLARE @DBName varchar(60)

  DECLARE @LogName varchar(60)
  DECLARE @recovery_model varchar(60)

  SELECT @DBName= DB_NAME()


  SELECT @LogName= name
  FROM sys.master_files
  Where db_id(@DBName) = database_id and  type_desc = 'LOG'


  SELECT @recovery_model = recovery_model_desc
  FROM sys.databases
  WHERE name = @DBName



  IF @recovery_model <> 'SIMPLE'
    BEGIN
      SET @SQL = N'ALTER DATABASE '+ @DBName+ N' SET RECOVERY SIMPLE;';
      exec sp_executesql @SQL
    END
  DBCC SHRINKFILE( @LogName , 2);


  IF @recovery_model <> 'SIMPLE'
  BEGIN
      IF @recovery_model = 'FULL'
          BEGIN
        SET @SQL = N'ALTER DATABASE '+ @DBName+ N' SET RECOVERY FULL;';
        exec sp_executesql @SQL
      END
      ELSE
      BEGIN
        SET @SQL = N'ALTER DATABASE '+ @DBName+ N' SET RECOVERY BULK_LOGGED;'
        exec sp_executesql @SQL
      END
      
  END /*IF*/

```


>
> ## That's it see you soon!.
> 