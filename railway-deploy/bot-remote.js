const fs = require('fs-extra');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Конфигурация из переменных окружения
const config = {
  botToken: process.env.BOT_TOKEN,
  webhookUrl: process.env.WEBHOOK_URL,
  port: process.env.PORT || 3000,
  adminChatId: process.env.ADMIN_CHAT_ID,
  moderationUrl: process.env.MODERATION_URL || 'https://your-ngrok-url.ngrok.io'
};

// Проверка обязательных переменных
if (!config.botToken) {
  console.error('❌ BOT_TOKEN не установлен!');
  process.exit(1);
}

if (!config.adminChatId) {
  console.error('❌ ADMIN_CHAT_ID не установлен!');
  process.exit(1);
}

console.log('🚀 Запуск Shomy Bay Bot (Railway Full Version)');
console.log('📱 Bot Token:', config.botToken ? '✅ Установлен' : '❌ Не установлен');
console.log('👤 Admin Chat ID:', config.adminChatId);
console.log('🌐 Moderation URL:', config.moderationUrl);

// Создаем бота
const bot = new TelegramBot(config.botToken, { 
  polling: false // Используем webhook
});

// Express сервер для webhook
const app = express();
app.use(express.json());

// Пути к данным (в памяти для Railway)
let users = {};
let listings = [];
let blockedUsers = [];

// Функции для работы с данными
async function loadData() {
  try {
    console.log('📊 Загружаем данные...');
    users = {};
    listings = [];
    blockedUsers = [];
    console.log('✅ Данные загружены');
  } catch (error) {
    console.log('⚠️ Ошибка загрузки данных:', error.message);
  }
}

async function saveData() {
  try {
    console.log('💾 Данные сохранены в памяти');
  } catch (error) {
    console.log('⚠️ Ошибка сохранения данных:', error.message);
  }
}

// Функция для проверки похожести слов (учитывает опечатки)
function isSimilar(str1, str2) {
  if (!str1 || !str2) return false;
  
  str1 = str1.toLowerCase().trim();
  str2 = str2.toLowerCase().trim();
  
  if (str1 === str2) return true;
  if (str1.includes(str2) || str2.includes(str2)) return true;
  
  if (str1.length <= 15 && str2.length <= 15) {
    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    const similarity = 1 - (distance / maxLength);
    return similarity > 0.7;
  }
  
  return false;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Главное меню
function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🛒 Купить' }, { text: '💰 Продать' }],
        [{ text: '🔍 Поиск' }, { text: '📋 Мои объявления' }],
        [{ text: '💎 Platinum' }]
      ],
      resize_keyboard: true
    }
  };
}

// Обработка команды /start
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`👤 Новый пользователь: ${userId} (@${msg.from.username || 'без username'})`);
  
  users[userId] = {
    profile: {
      username: msg.from.username || 'Неизвестно',
      firstName: msg.from.first_name || 'Неизвестно'
    },
    platinum: false,
    createdAt: new Date().toISOString()
  };
  
  const welcome = `🤖 **Shomy Bay Bot** (Railway Version)\n\n` +
    `Добро пожаловать в самый умный бот по покупке и продаже одежды!\n\n` +
    `✨ **Возможности:**\n` +
    `• 🔍 Поиск и фильтры\n` +
    `• 💰 Продажа товаров\n` +
    `• 🛒 Покупка товаров\n` +
    `• 💎 Platinum привилегии\n\n` +
    `Выберите действие:`;
  
  await bot.sendMessage(chatId, welcome, { 
    parse_mode: 'Markdown',
    ...mainMenuKeyboard()
  });
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (!text) return;
  
  console.log(`📨 Сообщение от ${userId}: ${text}`);
  
  // Обработка главных кнопок
  if (text === '🛒 Купить') {
    await showBuyMenu(bot, chatId);
    return;
  }
  
  if (text === '💰 Продать') {
    await startSellProcess(bot, chatId, userId);
    return;
  }
  
  if (text === '🔍 Поиск') {
    await showSearchMenu(bot, chatId);
    return;
  }
  
  if (text === '📋 Мои объявления') {
    await showMyListings(bot, chatId, userId);
    return;
  }
  
  if (text === '💎 Platinum') {
    await showPlatinumInfo(bot, chatId);
    return;
  }
  
  // Обработка сессий
  if (users[userId] && users[userId].session) {
    const session = users[userId].session;
    
    // Обработка продажи
    if (session.flow === 'sell') {
      await handleSellSession(bot, msg, session, userId);
      return;
    }
    
    // Обработка поиска
    if (session.flow === 'search') {
      await handleSearchSession(bot, msg, session, userId);
      return;
    }
  }
  
  // Обработка поисковых запросов
  if (text.length > 2) {
    await handleSearchQuery(bot, chatId, text);
  }
});

// Функции для обработки меню
async function showBuyMenu(bot, chatId) {
  await bot.sendMessage(chatId, 
    '🛒 **Покупка товаров**\n\n' +
    'Выберите способ поиска:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📰 Лента', callback_data: 'buy_feed' }],
          [{ text: '🔍 Поиск', callback_data: 'buy_search' }]
        ]
      }
    }
  );
}

async function startSellProcess(bot, chatId, userId) {
  users[userId] = users[userId] || {};
  users[userId].session = { flow: 'sell', step: 'title', temp: {} };
  await saveData();
  
  await bot.sendMessage(chatId, 
    '💰 **Создание объявления**\n\n' +
    '📝 **Шаг 1/6: Название товара**\n\n' +
    'Напишите название вашего товара:\n' +
    'Например: "Nike Air Force 1, размер 42"',
    { parse_mode: 'Markdown' }
  );
}

async function showSearchMenu(bot, chatId) {
  await bot.sendMessage(chatId, 
    '🔍 **Поиск товаров**\n\n' +
    'Введите ключевые слова для поиска:\n' +
    'Например: "кроссовки", "джинсы", "куртка"',
    { parse_mode: 'Markdown' }
  );
}

async function showMyListings(bot, chatId, userId) {
  const userListings = listings.filter(l => l.userId === userId);
  if (userListings.length === 0) {
    await bot.sendMessage(chatId, 'У вас пока нет объявлений.', mainMenuKeyboard());
    return;
  }
  
  let message = '📋 **Ваши объявления:**\n\n';
  userListings.forEach((listing, index) => {
    message += `${index + 1}. ${listing.title || 'Без названия'}\n`;
    if (listing.price) message += `💰 ${listing.price}₽\n`;
    if (listing.style) message += `🎨 ${listing.style}\n`;
    message += '\n';
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function showPlatinumInfo(bot, chatId) {
  await bot.sendMessage(chatId, 
    '💎 **Platinum привилегии**\n\n' +
    '✨ **Что дает Platinum:**\n' +
    '• Приоритетный показ объявлений +30%\n' +
    '• Больше людей увидят ваши объявления\n' +
    '• Специальный значок 💎 Platinum\n\n' +
    '💰 **Стоимость:** 300₽\n' +
    '🌐 **Оплата:** Через панель модерации\n' +
    `🔗 **Ссылка:** ${config.moderationUrl}`,
    { parse_mode: 'Markdown' }
  );
}

// Обработка сессий продажи
async function handleSellSession(bot, msg, session, userId) {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (session.step === 'title') {
    users[userId].session.temp.title = text;
    users[userId].session.step = 'price';
    await saveData();
    
    await bot.sendMessage(chatId, 
      '💰 **Создание объявления**\n\n' +
      '📝 **Шаг 2/6: Цена**\n\n' +
      'Укажите цену в рублях:\n' +
      'Например: "5000" или "5000₽"',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (session.step === 'price') {
    const price = text.replace(/[^\d]/g, '');
    if (!price || isNaN(price)) {
      await bot.sendMessage(chatId, '❌ Введите корректную цену (только цифры)');
      return;
    }
    
    users[userId].session.temp.price = price;
    users[userId].session.step = 'style';
    await saveData();
    
    await bot.sendMessage(chatId, 
      '💰 **Создание объявления**\n\n' +
      '📝 **Шаг 3/6: Стиль**\n\n' +
      'Выберите стиль одежды:\n' +
      '• Архив\n' +
      '• Кежуал\n' +
      '• Стритвир\n' +
      '• Спорт\n' +
      '• Другой',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (session.step === 'style') {
    users[userId].session.temp.style = text;
    users[userId].session.step = 'gender';
    await saveData();
    
    await bot.sendMessage(chatId, 
      '💰 **Создание объявления**\n\n' +
      '📝 **Шаг 4/6: Пол**\n\n' +
      'Для кого предназначена одежда:\n' +
      '• Мужской\n' +
      '• Женский\n' +
      '• Унисекс',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (session.step === 'gender') {
    users[userId].session.temp.gender = text;
    users[userId].session.step = 'description';
    await saveData();
    
    await bot.sendMessage(chatId, 
      '💰 **Создание объявления**\n\n' +
      '📝 **Шаг 5/6: Описание**\n\n' +
      'Опишите товар подробно:\n' +
      '• Состояние\n' +
      '• Размер\n' +
      '• Бренд\n' +
      '• Особенности',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (session.step === 'description') {
    users[userId].session.temp.description = text;
    users[userId].session.step = 'photo';
    await saveData();
    
    await bot.sendMessage(chatId, 
      '💰 **Создание объявления**\n\n' +
      '📝 **Шаг 6/6: Фото**\n\n' +
      'Отправьте фото товара или напишите "пропустить"',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (session.step === 'photo') {
    if (text.toLowerCase() === 'пропустить') {
      // Создаем объявление без фото
      const listing = {
        id: Date.now().toString(),
        userId: userId,
        title: users[userId].session.temp.title,
        price: users[userId].session.temp.price,
        style: users[userId].session.temp.style,
        gender: users[userId].session.temp.gender,
        description: users[userId].session.temp.description,
        createdAt: new Date().toISOString(),
        approved: true
      };
      
      listings.push(listing);
      users[userId].session = null;
      await saveData();
      
      await bot.sendMessage(chatId, 
        '✅ **Объявление создано!**\n\n' +
        `📝 **${listing.title}**\n` +
        `💰 **${listing.price}₽**\n` +
        `🎨 **${listing.style}**\n` +
        `👤 **${listing.gender}**\n\n` +
        'Ваше объявление добавлено в ленту!',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }
  }
}

// Обработка поисковых сессий
async function handleSearchSession(bot, msg, session, userId) {
  // Здесь можно добавить обработку поисковых сессий
}

// Обработка поисковых запросов
async function handleSearchQuery(bot, chatId, text) {
  const searchResults = listings.filter(listing => {
    const searchText = text.toLowerCase();
    const title = (listing.title || '').toLowerCase();
    const description = (listing.description || '').toLowerCase();
    return title.includes(searchText) || description.includes(searchText);
  });
  
  if (searchResults.length > 0) {
    let message = `🔍 **Результаты поиска по запросу "${text}":**\n\n`;
    searchResults.slice(0, 5).forEach((listing, index) => {
      message += `${index + 1}. ${listing.title || 'Без названия'}\n`;
      if (listing.price) message += `💰 ${listing.price}₽\n`;
      if (listing.style) message += `🎨 ${listing.style}\n`;
      message += '\n';
    });
    
    if (searchResults.length > 5) {
      message += `... и еще ${searchResults.length - 5} объявлений`;
    }
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, 
      `🔍 По запросу "${text}" ничего не найдено.\n\n` +
      'Попробуйте другие ключевые слова.',
      mainMenuKeyboard()
    );
  }
}

// Обработка callback запросов
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  console.log(`🔘 Callback от ${userId}: ${data}`);
  
  try {
    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.log('⚠️ Ошибка ответа на callback:', error.message);
  }
  
  if (data === 'buy_feed') {
    const availableListings = listings.filter(l => l.approved !== false);
    if (availableListings.length === 0) {
      await bot.sendMessage(chatId, 'Лента пуста. Объявлений пока нет.', mainMenuKeyboard());
      return;
    }
    
    const randomListing = availableListings[Math.floor(Math.random() * availableListings.length)];
    let message = `📰 **Объявление из ленты:**\n\n`;
    message += `📝 **${randomListing.title || 'Без названия'}**\n`;
    if (randomListing.price) message += `💰 **Цена:** ${randomListing.price}₽\n`;
    if (randomListing.style) message += `🎨 **Стиль:** ${randomListing.style}\n`;
    if (randomListing.description) message += `📄 **Описание:** ${randomListing.description}\n`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return;
  }
  
  if (data === 'buy_search') {
    await bot.sendMessage(chatId, 
      '🔍 **Поиск товаров**\n\n' +
      'Введите ключевые слова для поиска:\n' +
      'Например: "кроссовки", "джинсы", "куртка"',
      { parse_mode: 'Markdown' }
    );
    return;
  }
});

// Webhook endpoint для получения обновлений
app.post('/webhook', (req, res) => {
  const update = req.body;
  console.log('📨 Webhook получен:', update);
  
  bot.processUpdate(update);
  
  res.status(200).send('OK');
});

// Статус endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    bot: 'running',
    users: Object.keys(users).length,
    listings: listings.length,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '2.0.0'
  });
});

// Главная страница
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Shomy Bay Bot</h1>
    <p><strong>Статус:</strong> Онлайн</p>
    <p><strong>Пользователи:</strong> ${Object.keys(users).length}</p>
    <p><strong>Объявления:</strong> ${listings.length}</p>
    <p><strong>Время работы:</strong> ${Math.floor(process.uptime())} сек</p>
    <hr>
    <p><strong>Панель модерации:</strong> <a href="${config.moderationUrl}">${config.moderationUrl}</a></p>
    <p><strong>Webhook URL:</strong> ${config.webhookUrl || 'Не настроен'}</p>
  `);
});

// Запуск сервера
async function start() {
  try {
    await loadData();
    
    if (config.webhookUrl) {
      console.log('🔗 Настраиваем webhook...');
      await bot.setWebHook(`${config.webhookUrl}/webhook`);
      console.log('✅ Webhook настроен');
    } else {
      console.log('⚠️ WEBHOOK_URL не указан, используем polling');
      bot.startPolling();
    }
    
    app.listen(config.port, () => {
      console.log(`🚀 Сервер запущен на порту ${config.port}`);
      console.log(`🌐 Статус: http://localhost:${config.port}/status`);
      console.log(`📱 Bot Token: ${config.botToken ? '✅' : '❌'}`);
      console.log(`👤 Admin Chat: ${config.adminChatId}`);
    });
    
    if (config.adminChatId) {
      try {
        await bot.sendMessage(config.adminChatId, 
          '🚀 **Shomy Bay Bot запущен!**\n\n' +
          `🌐 **Статус:** http://localhost:${config.port}/status\n` +
          `🔗 **Модерация:** ${config.moderationUrl}\n` +
          `⏰ **Время:** ${new Date().toLocaleString('ru-RU')}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.log('⚠️ Не удалось отправить уведомление админу:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

// Обработка завершения
process.on('SIGINT', async () => {
  console.log('\n🛑 Получен сигнал завершения...');
  await saveData();
  console.log('✅ Данные сохранены');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Получен сигнал завершения...');
  await saveData();
  console.log('✅ Данные сохранены');
  process.exit(0);
});

// Запуск
start();