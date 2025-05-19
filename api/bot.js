const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Получение или создание Telegram Board
const getTelegramBoard = async (userId) => {
  const res = await pool.query(
    `INSERT INTO boards (user_id, name)
     VALUES ($1, 'Telegram Board')
     ON CONFLICT (user_id, name) DO UPDATE SET name=EXCLUDED.name
     RETURNING uuid`,
    [userId]
  );
  return res.rows[0].uuid;
};

// Обработка команды /start
// Обработка команды /start с использованием имени из Telegram
bot.start(async (ctx) => {
  const chatId = ctx.message.chat.id;
  const userInfo = ctx.from; // Данные пользователя из ctx.from

  try {
    let user;
    const userCheck = await pool.query(
      'SELECT uuid FROM users WHERE chat_id = $1',
      [chatId]
    );

    if (userCheck.rowCount === 0) {
      // Формируем имя из first_name и last_name
      const firstName = userInfo.first_name || '';
      const lastName = userInfo.last_name || '';
      const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`.trim();

      // Если оба имени отсутствуют, используем chat_id
      const displayName = fullName || `Telegram User ${chatId}`;

      const newUser = await pool.query(
        `INSERT INTO users (name, chat_id)
         VALUES ($1, $2)
         RETURNING uuid`,
        [displayName, chatId]
      );
      user = newUser.rows[0];
    } else {
      user = userCheck.rows[0];
    }

    await getTelegramBoard(user.uuid);
    ctx.reply(`✅ Привет, ${userInfo.first_name || 'друг'}! Бот активирован.`);
    
  } catch (error) {
    console.error('Start error:', error);
    ctx.reply('⛔ Ошибка инициализации. Попробуйте снова.');
  }
});

// Сохранение сообщений
// Сохранение сообщений с динамическим позиционированием
bot.on('text', async (ctx) => {
  const chatId = ctx.message.chat.id;
  const text = ctx.message.text;

  try {
    // Автоматическая регистрация при первом сообщении
    let user = await pool.query(
      'SELECT uuid FROM users WHERE chat_id = $1',
      [chatId]
    );

    if (user.rowCount === 0) {
      await ctx.reply('🔑 Сначала активируем ваш аккаунт...');
      return bot.start(ctx);
    }

    const boardId = await getTelegramBoard(user.rows[0].uuid);
    
    // Получаем последнюю заметку пользователя
    const lastNote = await pool.query(
      `SELECT x, width FROM notes 
       WHERE board_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [boardId]
    );

    // Рассчитываем новую позицию
    let newX = 10; // Начальное смещение
    const spacing = 20;
    
    if (lastNote.rowCount > 0) {
      newX = lastNote.rows[0].x + lastNote.rows[0].width + spacing;
    }

    // Сохраняем новую заметку
    await pool.query(
      `INSERT INTO notes (board_id, text, x, y, width, height, created_at)
       VALUES ($1, $2, $3, 10, 200, 100, NOW())`,
      [boardId, text, newX]
    );

    await ctx.reply('💾 Сообщение сохранено! Новая позиция: ' + newX + 'px');
    
  } catch (error) {
    console.error('Save error:', error);
    ctx.reply('❌ Ошибка сохранения. Попробуйте отправить сообщение ещё раз.');
  }
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  } else {
    res.status(200).send('Telegram Board Bot v2.0');
  }
};
