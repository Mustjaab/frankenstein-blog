const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// FIX: Explicitly set views directory
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Simple session management (in production, use express-session)
let isAuthenticated = false;
const BLOG_PASSWORD = process.env.BLOG_PASSWORD || "change-in-production";

// Helper function to read articles
function getArticles() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'articles.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading articles:', error);
    return [];
  }
}

// Helper function to read drafts
function getDrafts() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'drafts.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading drafts:', error);
    return [];
  }
}

// Helper function to write articles
function saveArticles(articles) {
  fs.writeFileSync(
    path.join(__dirname, 'articles.json'), 
    JSON.stringify(articles, null, 2)
  );
}

// Helper function to write drafts
function saveDrafts(drafts) {
  fs.writeFileSync(
    path.join(__dirname, 'drafts.json'), 
    JSON.stringify(drafts, null, 2)
  );
}

// Simple Markdown to HTML converter
function markdownToHtml(markdown) {
  return markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Links
    .replace(/\[([^\[]+)\]\(([^\)]+)\)/gim, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n$/gim, '<br>')
    // Paragraphs (convert double newlines to paragraphs)
    .split(/\n\n+/)
    .map(paragraph => {
      if (paragraph.trim().startsWith('<h') || paragraph.trim().startsWith('<')) {
        return paragraph;
      }
      return `<p>${paragraph}</p>`;
    })
    .join('\n');
}

// Routes
app.get('/', (req, res) => {
  const articles = getArticles();
  res.render('index', { 
    posts: articles,
    isAuthenticated: isAuthenticated
  });
});

app.get('/post/:id', (req, res) => {
  const articles = getArticles();
  const post = articles.find(p => p.id === parseInt(req.params.id));
  res.render('post', { 
    post: post,
    isAuthenticated: isAuthenticated
  });
});

// New: load published post into editor
app.get('/edit-post/:id', (req, res) => {
  if (!isAuthenticated) return res.redirect('/login');

  const articles = getArticles();
  const post = articles.find(p => p.id === parseInt(req.params.id));
  if (!post) return res.redirect('/');

  // When rendering editor, provide 'post' (published) so the form can prefill
  // Use rawContent if available (original markdown), otherwise fall back to content (HTML)
  res.render('new-post', {
    draft: null,
    post: post,
    isAuthenticated: isAuthenticated
  });
});

// Authentication routes
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  if (req.body.password === BLOG_PASSWORD) {
    isAuthenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  isAuthenticated = false;
  res.redirect('/');
});

// Drafts management
app.get('/drafts', (req, res) => {
  if (!isAuthenticated) {
    return res.redirect('/login');
  }
  const drafts = getDrafts();
  res.render('drafts', { 
    drafts: drafts,
    isAuthenticated: isAuthenticated
  });
});

// New post form (with draft loading support)
app.get('/new-post', (req, res) => {
  if (!isAuthenticated) {
    return res.redirect('/login');
  }
  
  let draft = null;
  if (req.query.draft) {
    const drafts = getDrafts();
    draft = drafts.find(d => d.id === parseInt(req.query.draft));
  }
  
  res.render('new-post', { 
    draft: draft,
    post: null,
    isAuthenticated: isAuthenticated
  });
});

// Save as draft
app.post('/save-draft', (req, res) => {
  if (!isAuthenticated) {
    return res.redirect('/login');
  }
  
  const drafts = getDrafts();
  
  // Process tags for draft
  let tags = ['Uncategorized'];
  if (req.body.tags && req.body.tags.trim() !== '') {
    tags = req.body.tags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag !== '');
  }
  
  const draftData = {
    id: req.body.draftId ? parseInt(req.body.draftId) : (drafts.length > 0 ? Math.max(...drafts.map(d => d.id)) + 1 : 1),
    title: req.body.title || 'Untitled Draft',
    excerpt: req.body.excerpt || '',
    content: req.body.content || '',
    author: req.body.author || 'Mustjaab',
    date: new Date().toISOString().split('T')[0],
    tags: tags,
    lastSaved: new Date().toLocaleString()
  };
  
  // Update existing draft or add new one
  const existingIndex = drafts.findIndex(d => d.id === draftData.id);
  if (existingIndex !== -1) {
    drafts[existingIndex] = draftData;
  } else {
    drafts.push(draftData);
  }
  
  saveDrafts(drafts);
  res.redirect('/drafts?saved=1');
});

// Publish post (create new or update existing)
app.post('/save-post', (req, res) => {
  if (!isAuthenticated) {
    return res.redirect('/login');
  }
  
  const articles = getArticles();
  const drafts = getDrafts();
  
  // Process tags
  let tags = ['Uncategorized'];
  if (req.body.tags && req.body.tags.trim() !== '') {
    tags = req.body.tags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag !== '');
  }
  
  // Raw markdown (store for future edits). Might be empty if user provided HTML only.
  const rawContent = req.body.content || '';
  // Convert Markdown to HTML if content is provided
  const contentHtml = rawContent ? markdownToHtml(rawContent) : '';

  if (req.body.postId) {
    // Update existing post
    const postId = parseInt(req.body.postId);
    const idx = articles.findIndex(p => p.id === postId);
    if (idx !== -1) {
      const updatedPost = {
        ...articles[idx],
        title: req.body.title || articles[idx].title,
        excerpt: req.body.excerpt || articles[idx].excerpt,
        content: contentHtml || articles[idx].content,
        rawContent: rawContent || articles[idx].rawContent || '',
        author: req.body.author || articles[idx].author,
        date: new Date().toISOString().split('T')[0],
        tags: tags
      };
      articles[idx] = updatedPost;
      saveArticles(articles);
      // Remove from drafts if it was a draft
      if (req.body.draftId) {
        const updatedDrafts = drafts.filter(d => d.id !== parseInt(req.body.draftId));
        saveDrafts(updatedDrafts);
      }
      return res.redirect(`/post/${postId}`);
    }
    // fallthrough to create new if the ID wasn't found
  }
  
  // Create new post
  const newPost = {
    id: articles.length > 0 ? Math.max(...articles.map(p => p.id)) + 1 : 1,
    title: req.body.title,
    excerpt: req.body.excerpt,
    content: contentHtml,
    rawContent: rawContent,
    author: req.body.author,
    date: new Date().toISOString().split('T')[0],
    tags: tags
  };
  
  articles.push(newPost);
  saveArticles(articles);
  
  // Remove from drafts if it was a draft
  if (req.body.draftId) {
    const updatedDrafts = drafts.filter(d => d.id !== parseInt(req.body.draftId));
    saveDrafts(updatedDrafts);
  }
  
  res.redirect(`/post/${newPost.id}`);
});

// Delete draft
app.post('/delete-draft/:id', (req, res) => {
  if (!isAuthenticated) {
    return res.redirect('/login');
  }
  
  const drafts = getDrafts();
  const updatedDrafts = drafts.filter(d => d.id !== parseInt(req.params.id));
  saveDrafts(updatedDrafts);
  res.redirect('/drafts');
});

app.post('/delete-post/:id', (req, res) => {
  if (!isAuthenticated) {
    return res.redirect('/login');
  }
  
  const articles = getArticles();
  const updatedArticles = articles.filter(p => p.id !== parseInt(req.params.id));
  saveArticles(updatedArticles);
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`Frankenstein blog running on port ${PORT}`);
});
