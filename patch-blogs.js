const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./public/blogs.json', 'utf8'));

data.articles.forEach(article => {
  article.metaTitle = article.title + " | Healthy Meal Spot";
  article.metaDescription = article.excerpt || "Read this insightful article on " + article.title;
});

fs.writeFileSync('./public/blogs.json', JSON.stringify(data, null, 2));
