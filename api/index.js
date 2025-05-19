const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// Конфигурация PostgreSQL
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Helper для обработки ошибок
const handleError = (res, error) => {
  console.error(error);
  res.status(500).json({ error: 'Internal Server Error' });
};

const generateSessionId = () => crypto.randomBytes(64).toString('hex');

// Middleware проверки сессии
const checkSession = async (req, res, next) => {
  try {
    const sessionId = req.headers.authorization?.split(' ')[1]; // Формат: Bearer <session_id>
    if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      'SELECT user_id FROM sessions WHERE session_id = $1 AND expires_at > NOW()',
      [sessionId]
    );

    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid session' });
    
    req.userId = result.rows[0].user_id; // Добавляем user_id в запрос
    next();
  } catch (error) {
    handleError(res, error);
  }
};

// Обновленный эндпоинт аутентификации
app.post('/api/auth', async (req, res) => {
  try {
    const { email, password } = req.body;
    const userResult = await pool.query(
      'SELECT uuid FROM users WHERE email = $1 AND password = crypt($2, password)',
      [email, password]
    );
    
    if (userResult.rowCount === 0) return res.status(401).end();

    // Создаем сессию
    const sessionId = generateSessionId();
    await pool.query(
      'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 DAYS\')',
      [sessionId, userResult.rows[0].uuid]
    );

    res.json({ token: sessionId }); // Возвращаем session_id как токен
  } catch (error) {
    handleError(res, error);
  }
});

// Регистрация (дополнено)
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Проверка существующего пользователя
    const userExists = await pool.query(
      'SELECT email FROM users WHERE email = $1',
      [email]
    );
    
    if (userExists.rowCount > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Создание пользователя с хешированным паролем
    const result = await pool.query(
      `INSERT INTO users (name, email, password)
       VALUES ($1, $2, crypt($3, gen_salt('bf')))
       RETURNING uuid, name, email`,
      [name, email, password]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});

// Создать новую доску (дополнено)
app.post('/api/board/', checkSession, async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.headers.authorization;
    
    if (!name) {
      return res.status(400).json({ error: 'Board name is required' });
    }

    const result = await pool.query(
      `INSERT INTO boards (user_id, name)
       VALUES ($1, $2)
       RETURNING uuid, name`,
      [userId, name]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});

// Получить текущего пользователя (исправлено)
app.get('/api/user/me', checkSession, async (req, res) => {
  try {
    const userId = req.headers.authorization;
    const result = await pool.query(
      'SELECT uuid, name, avatar, email FROM users WHERE uuid = $1',
      [userId]
    );
    
    if (result.rowCount === 0) return res.status(404).end();
    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});


// Список досок
app.get('/api/board/list', checkSession, async (req, res) => {
  try {
    const userId = req.headers.authorization;
    const result = await pool.query(
      'SELECT uuid, name FROM boards WHERE user_id = $1',
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    handleError(res, error);
  }
});

// Получить доску
app.get('/api/board/:id', checkSession, async (req, res) => {
  try {
    const board = await pool.query(
      'SELECT uuid, name FROM boards WHERE uuid = $1',
      [req.params.id]
    );
    
    const notes = await pool.query(
      'SELECT * FROM notes WHERE board_id = $1',
      [req.params.id]
    );
    
    res.json({
      ...board.rows[0],
      notes: notes.rows
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Создать заметку
app.post('/api/note', checkSession, async (req, res) => {
  try {
    const { board_id, x, y, width, height, text, font_size } = req.body;
    const result = await pool.query(
      `INSERT INTO notes (board_id, x, y, width, height, text, font_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING uuid`,
      [board_id, x, y, width, height, text, font_size]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});

// Редактирование заметки
app.put('/api/note/:id', checkSession, async (req, res) => {
  try {
    const noteId = req.params.id;
    const { text, x, y, width, height, font_size } = req.body;

    // Проверка прав доступа
    const noteCheck = await pool.query(
      `SELECT n.* FROM notes n
       JOIN boards b ON n.board_id = b.uuid
       WHERE n.uuid = $1 AND b.user_id = $2`,
      [noteId, req.userId]
    );

    if (noteCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found or access denied' });
    }

    // Обновление данных
    const result = await pool.query(
      `UPDATE notes SET
        text = COALESCE($1, text),
        x = COALESCE($2, x),
        y = COALESCE($3, y),
        width = COALESCE($4, width),
        height = COALESCE($5, height),
        font_size = COALESCE($6, font_size)
       WHERE uuid = $7
       RETURNING *`,
      [text, x, y, width, height, font_size, noteId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});

// Редактирование данных пользователя
app.put('/api/user/me', checkSession, async (req, res) => {
  try {
    const { name, avatar } = req.body;

    // Валидация данных
    if (!name && !avatar) {
      return res.status(400).json({ error: 'No data to update' });
    }

    // Обновление профиля
    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        avatar = COALESCE($2, avatar)
       WHERE uuid = $3
       RETURNING uuid, name, avatar, email`,
      [name, avatar, req.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});

// Маршрут для веб-интерфейса
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Добавляем обработку CORS (дополнение)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://yellownote.vercel.app');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Credentials', 'true'); // Для кук, если нужно
  next();
});

// Добавляем обработку 404 (дополнение)
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

module.exports = app;
