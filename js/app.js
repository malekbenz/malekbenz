angular.module('JekyllBlog', [])
  .controller('SearchCtrl', ['$scope', '$http', function($scope, $http) {
    $http.get('/posts.json').success(function(data) {
      $scope.posts = data.posts;
    });
  }]);


// # index.html

// <div class="posts" ng-controller="SearchCtrl">
//   <input type="search" class="search" ng-model="query">
//   <ul>
//     <li ng-repeat="post in posts | filter:query ">
//       <date ng-bind="post.date"></date>
//       <a href="{% raw %}{{ post.url }}{% endraw %}" ng-bind="post.title"></a>
//     </li>
//   </ul>
// </div>