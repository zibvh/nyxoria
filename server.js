const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  }
});

// ── Mongoose Schema ─────────────────────────────────────────────────────────
const chapterSchema = new mongoose.Schema({
  title: { type: String, required: true },
  text:  { type: String, default: '' }
});

const bookSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  genre:      { type: String, default: 'Novel' },
  status:     { type: String, enum: ['published', 'draft'], default: 'draft' },
  summary:    { type: String, default: '' },
  tags:       { type: [String], default: [] },
  views:      { type: Number, default: 0 },
  coverData:  { type: String, default: null },
  chapters:   [chapterSchema],
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now }
});

const Book = mongoose.model('Book', bookSchema);

// ── MongoDB Connect ─────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log('✦ MongoDB connected'))
  .catch(err => { console.error('MongoDB error:', err.message); process.exit(1); });

// ── Public Routes ────────────────────────────────────────────────────────────

// GET /api/books — all published books
app.get('/api/books', async (req, res) => {
  try {
    const books = await Book.find({ status: 'published' })
      .select('title genre status summary tags coverData chapters createdAt updatedAt views')
      .sort({ createdAt: -1 });
    const lite = books.map(b => ({
      _id:          b._id,
      title:        b.title,
      genre:        b.genre,
      summary:      b.summary,
      tags:         b.tags,
      status:       b.status,
      coverData:    b.coverData,
      chapterCount: b.chapters.length,
      createdAt:    b.createdAt,
      updatedAt:    b.updatedAt,
      views:        b.views
    }));
    res.json(lite);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/books/:id — single published book (increments views)
app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await Book.findOneAndUpdate(
      { _id: req.params.id, status: 'published' },
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin Routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/books', async (req, res) => {
  try {
    const books = await Book.find().sort({ createdAt: -1 });
    res.json(books);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/books/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/books', async (req, res) => {
  try {
    const { title, genre, status, summary, tags, coverData, chapters } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const book = new Book({
      title, genre, status,
      summary: summary || '',
      tags: Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [],
      coverData: coverData || null,
      chapters: chapters || []
    });
    await book.save();
    res.status(201).json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/books/:id', async (req, res) => {
  try {
    const { title, genre, status, summary, tags, coverData, chapters } = req.body;
    const update = { updatedAt: new Date() };
    if (title    !== undefined) update.title    = title;
    if (summary  !== undefined) update.summary  = summary;
    if (genre    !== undefined) update.genre    = genre;
    if (status   !== undefined) update.status   = status;
    if (chapters !== undefined) update.chapters = chapters;
    if (tags     !== undefined) update.tags     = Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [];
    if (coverData !== undefined) update.coverData = coverData || null;

    const book = await Book.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/books/:id', async (req, res) => {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/books', async (req, res) => {
  try {
    await Book.deleteMany({});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const [published, drafts, all] = await Promise.all([
      Book.countDocuments({ status: 'published' }),
      Book.countDocuments({ status: 'draft' }),
      Book.find().select('chapters views')
    ]);
    const totalChapters = all.reduce((sum, b) => sum + b.chapters.length, 0);
    const totalViews    = all.reduce((sum, b) => sum + (b.views || 0), 0);
    res.json({ published, drafts, totalChapters, totalViews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✦ Nyxoria running at http://localhost:${PORT}`);
});
