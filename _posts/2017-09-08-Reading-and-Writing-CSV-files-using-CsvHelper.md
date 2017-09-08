---
layout: post
title: "Reading and Writing CSV files using CsvHelper"
date: 2017-09-08
author: Malekbenz
comments: true
category: C#
tags : [ 'C#' ,'CsvHelper' ]
categories: ['C#']
description: Reading and Writing CSV files using CsvHelper.
image: /images/csvHelper/cover.png
---


[CsvHelper](https://joshclose.github.io/CsvHelper/) is .NET library for reading and writing CSV files. Extremely fast, flexible and easy to use. Supports reading and writing of custom class objects.

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
 
## Simple application        

Create a new **Console application**  & install [CsvHelper](https://joshclose.github.io/CsvHelper/) by running the following from the Package Manager Console.

```
Install-Package CsvHelper

```

### A Person Class     

```
    internal class Person
    {
        public string Name { get; set; }
        public int Age { get; set; }
    }


```



### Reading function     

```
        static void ReadCsvFile(string filename)
        {
            TextReader textReader = File.OpenText(filename);
            var csv = new CsvReader(textReader);

            var people = csv.GetRecords<Person>();

            foreach (var person in people)
            {
                Console.WriteLine($"Name {person.Name} age : {person.Age}");
            }
            textReader.Close();

        }

```

### Writing  function     

```
        static void WriteCsvFile(string filename, IEnumerable<Person> people)
        {
            TextWriter textWriter = File.CreateText(filename);

            var csvWriter = new CsvWriter(textWriter);
            csvWriter.WriteRecords(people);

            textWriter.Close();

        }


```

### Main  function     

```
        static void Main(string[] args)
        {
            var filename = Directory.GetCurrentDirectory() + @"\file.csv";
            List<Person> list = new List<Person>() {
                new  Person(){Name= "Ronaldo", Age= 29},
                new  Person(){Name= "Missi", Age= 28}
        };

            WriteCsvFile(filename, list);

            ReadCsvFile(filename);
            Console.ReadLine();
        }


```



>
> **NOTE:** For more informations , please see  [CsvHelper](https://joshclose.github.io/CsvHelper/). 
> 

![CMD](/images/csvHelper/cover.png){:class="img-responsive" }

>
> ## That's it see you soon!.
> 