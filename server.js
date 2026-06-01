const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = 'mongodb+srv://Nyxoria:nyxoria@midnight.hxjptxk.mongodb.net/nyxoria?appName=Midnight';

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer — store cover images in memory as Buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
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
  coverData:  { type: String, default: null }, // base64 data-url
  chapters:   [chapterSchema],
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now }
});

const Book = mongoose.model('Book', bookSchema);

// ── MongoDB Connect ─────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log('✦ MongoDB connected'))
  .catch(err => { console.error('MongoDB error:', err.message); process.exit(1); });

// ── Public Routes (no auth needed) ──────────────────────────────────────────

// GET /api/books — all published books (for public index)
app.get('/api/books', async (req, res) => {
  try {
    const books = await Book.find({ status: 'published' })
      .select('title genre status coverData chapters createdAt updatedAt')
      .sort({ createdAt: -1 });
    // Return chapters without text for index listing (faster)
    const lite = books.map(b => ({
      _id:       b._id,
      title:     b.title,
      genre:     b.genre,
      status:    b.status,
      coverData: b.coverData,
      chapterCount: b.chapters.length,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    }));
    res.json(lite);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/books/:id — single published book WITH chapters (for reader)
app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await Book.findOne({ _id: req.params.id, status: 'published' });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin Routes ─────────────────────────────────────────────────────────────

// GET /api/admin/books — ALL books (published + draft)
app.get('/api/admin/books', async (req, res) => {
  try {
    const books = await Book.find().sort({ createdAt: -1 });
    res.json(books);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/books/:id — single book for editing
app.get('/api/admin/books/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/books — create book (JSON body with optional base64 cover)
app.post('/api/admin/books', async (req, res) => {
  try {
    const { title, genre, status, coverData, chapters } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const book = new Book({ title, genre, status, coverData: coverData || null, chapters: chapters || [] });
    await book.save();
    res.status(201).json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/books/:id — update book
app.put('/api/admin/books/:id', async (req, res) => {
  try {
    const { title, genre, status, coverData, chapters } = req.body;
    const update = { updatedAt: new Date() };
    if (title    !== undefined) update.title    = title;
    if (genre    !== undefined) update.genre    = genre;
    if (status   !== undefined) update.status   = status;
    if (chapters !== undefined) update.chapters = chapters;
    // Only update coverData if explicitly sent (null = remove, string = new cover, undefined = keep existing)
    if (coverData !== undefined) update.coverData = coverData || null;

    const book = await Book.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/books/:id
app.delete('/api/admin/books/:id', async (req, res) => {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/books — delete ALL books
app.delete('/api/admin/books', async (req, res) => {
  try {
    await Book.deleteMany({});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [published, drafts, all] = await Promise.all([
      Book.countDocuments({ status: 'published' }),
      Book.countDocuments({ status: 'draft' }),
      Book.find().select('chapters')
    ]);
    const totalChapters = all.reduce((sum, b) => sum + b.chapters.length, 0);
    res.json({ published, drafts, totalChapters });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Catch-all — serve index.html for SPA routing ─────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✦ Nyxoria running at http://localhost:${PORT}`);
});
