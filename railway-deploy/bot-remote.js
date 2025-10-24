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

console.log('🚀 Запуск Shomy Bay Bot (Remote Version)');
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
    // В Railway данные храним в памяти
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
    // В Railway данные не сохраняем на диск
    console.log('💾 Данные сохранены в памяти');
  } catch (error) {
    console.log('⚠️ Ошибка сохранения данных:', error.message);
  }
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
  
  // Сохраняем пользователя
  users[userId] = {
    profile: {
      username: msg.from.username || 'Неизвестно',
      firstName: msg.from.first_name || 'Неизвестно'
    },
    platinum: false,
    createdAt: new Date().toISOString()
  };
  
  const welcome = `🤖 **Shomy Bay Bot** (Remote Version)\n\n` +
    `Добро пожаловать в самый умный бот по покупке и продаже одежды!\n\n` +
    `✨ **Возможности:**\n` +
    `• 🔍 Поиск и фильтры\n` +
    `• 💰 Продажа товаров\n` +
    `• 🛒 Покупка товаров\n` +
    `• 💎 Platinum привилегии\n\n` +
    `🌐 **Панель модерации:** ${config.moderationUrl}\n\n` +
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
    return;
  }
  
  if (text === '💰 Продать') {
    await bot.sendMessage(chatId, 
      '💰 **Продажа товаров**\n\n' +
      'Выберите способ создания объявления:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Создать объявление', callback_data: 'sell_create' }],
            [{ text: '📝 Готовое объявление', callback_data: 'sell_parse' }]
          ]
        }
      }
    );
    return;
  }
  
  if (text === '🔍 Поиск') {
    await bot.sendMessage(chatId, 
      '🔍 **Поиск товаров**\n\n' +
      'Введите ключевые слова для поиска:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎯 Фильтры', callback_data: 'search_filters' }],
            [{ text: '📰 Лента', callback_data: 'search_feed' }]
          ]
        }
      }
    );
    return;
  }
  
  if (text === '📋 Мои объявления') {
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
    return;
  }
  
  if (text === '💎 Platinum') {
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
    return;
  }
  
  // Обработка поисковых запросов
  if (text.length > 2) {
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
        'Попробуйте другие ключевые слова или используйте фильтры.',
        mainMenuKeyboard()
      );
    }
  }
});

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
  
  if (data === 'sell_create') {
    await bot.sendMessage(chatId, 
      '➕ **Создание объявления**\n\n' +
      'Для создания объявления используйте панель модерации:\n' +
      `🔗 ${config.moderationUrl}\n\n` +
      'Там вы сможете:\n' +
      '• Загрузить фото\n' +
      '• Указать все детали\n' +
      '• Опубликовать объявление',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (data === 'search_filters') {
    await bot.sendMessage(chatId, 
      '🎯 **Фильтры поиска**\n\n' +
      'Для настройки фильтров используйте панель модерации:\n' +
      `🔗 ${config.moderationUrl}\n\n` +
      'Доступные фильтры:\n' +
      '• 👤 Пол (мужской/женский)\n' +
      '• 🎨 Стиль (архив, кежуал, стритвир)\n' +
      '• 👕 Категория одежды\n' +
      '• 💰 Цена (от/до)\n' +
      '• 🏷️ Бренд',
      { parse_mode: 'Markdown' }
    );
    return;
  }
});

// Webhook endpoint для получения обновлений
app.post('/webhook', (req, res) => {
  const update = req.body;
  console.log('📨 Webhook получен:', update);
  
  // Обрабатываем обновление
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
    version: '1.0.0'
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
    // Загружаем данные
    await loadData();
    
    // Настраиваем webhook если указан URL
    if (config.webhookUrl) {
      console.log('🔗 Настраиваем webhook...');
      await bot.setWebHook(`${config.webhookUrl}/webhook`);
      console.log('✅ Webhook настроен');
    } else {
      console.log('⚠️ WEBHOOK_URL не указан, используем polling');
      bot.startPolling();
    }
    
    // Запускаем сервер
    app.listen(config.port, () => {
      console.log(`🚀 Сервер запущен на порту ${config.port}`);
      console.log(`🌐 Статус: http://localhost:${config.port}/status`);
      console.log(`📱 Bot Token: ${config.botToken ? '✅' : '❌'}`);
      console.log(`👤 Admin Chat: ${config.adminChatId}`);
    });
    
    // Отправляем уведомление админу
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
