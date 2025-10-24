const fs = require('fs-extra');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const cryptoBot = require('./cryptobot');

// Функции для работы с заблокированными пользователями
async function readBlockedUsers() {
  try {
    return await fs.readJson('./data/blocked_users.json');
  } catch {
    return [];
  }
}

async function isUserBlocked(userId) {
  const blockedUsers = await readBlockedUsers();
  return blockedUsers.includes(String(userId));
}
const feedControls = require('./feed_controls');

// Функция для проверки похожести слов (учитывает опечатки)
function isSimilar(str1, str2) {
  if (!str1 || !str2) return false;
  
  // Убираем лишние пробелы и приводим к нижнему регистру
  str1 = str1.toLowerCase().trim();
  str2 = str2.toLowerCase().trim();
  
  // Точное совпадение
  if (str1 === str2) return true;
  
  // Одно слово содержит другое
  if (str1.includes(str2) || str2.includes(str1)) return true;
  
  // Проверяем расстояние Левенштейна для коротких слов
  if (str1.length <= 15 && str2.length <= 15) {
    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    const similarity = 1 - (distance / maxLength);
    
    // Если похожесть больше 70%, считаем похожими
    return similarity > 0.7;
  }
  
  return false;
}

// Функция для вычисления расстояния Левенштейна
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
          matrix[i - 1][j - 1] + 1, // замена
          matrix[i][j - 1] + 1,     // вставка
          matrix[i - 1][j] + 1      // удаление
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Ensure data directory
const dataDir = path.resolve('./data');
const usersPath = path.join(dataDir, 'users.json');
const listingsPath = path.join(dataDir, 'listings.json');

async function ensureDataFiles() {
  await fs.ensureDir(dataDir);
  if (!(await fs.pathExists(usersPath))) await fs.writeJson(usersPath, {}, { spaces: 2 });
  if (!(await fs.pathExists(listingsPath))) await fs.writeJson(listingsPath, [], { spaces: 2 });
}

async function readUsers() {
  try { return await fs.readJson(usersPath); } catch (_) { return {}; }
}

async function writeUsers(users) {
  await fs.writeJson(usersPath, users, { spaces: 2 });
}

async function readListings() {
  try { return await fs.readJson(listingsPath); } catch (_) { return []; }
}

async function writeListings(listings) {
  await fs.writeJson(listingsPath, listings, { spaces: 2 });
}


function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🛒 Купить' }, { text: '💰 Продать' }],
        [{ text: '📋 Мои объявления' }, { text: '💎 Platinum' }]
      ],
      resize_keyboard: true
    }
  };
}

function subscriptionKeyboard() {
  const titles = config.marketBot.sponsorTitles || ['мой канал', 'твой канал'];
  const channels = config.marketBot.requiredChannels || [];
  const buttons = channels.map((ch, idx) => [{ text: titles[idx] || ch, url: `https://t.me/${ch.replace('@','')}` }]);
  return {
    reply_markup: {
      inline_keyboard: [
        ...buttons,
        [{ text: '✅ Проверить подписки', callback_data: 'check_subs' }]
      ]
    }
  };
}

async function isUserSubscribed(bot, userId) {
  const channels = config.marketBot.requiredChannels || [];
  if (channels.length === 0) return true;
  try {
    for (const ch of channels) {
      const res = await bot.getChatMember(ch, userId);
      const status = res && res.status ? res.status : 'left';
      if (['left', 'kicked', 'restricted'].includes(status)) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function listingKeyboard(listingId) {
  // legacy inline keyboard (no longer shown in feed)
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Да', callback_data: `l_yes:${listingId}` },
          { text: '❌ Нет', callback_data: `l_no:${listingId}` },
          { text: '⚙️ Параметры', callback_data: `l_params:${listingId}` }
        ]
      ]
    }
  };
}

const feedReplyKeyboard = (ownerOnly = false, postLike = false) => feedControls.buildFeedKeyboard(ownerOnly, postLike);

async function setFeedKeyboard(bot, chatId, users, uid, variant) {
  if (variant === 'post_like') return feedControls.enablePostLike(bot, chatId, users, uid, writeUsers);
  return feedControls.resetModeAndShowBase(bot, chatId, users, uid, writeUsers);
}

function removeReplyKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}

async function hideReplyKeyboard(bot, chatId) {
  try {
    await bot.sendMessage(chatId, '\u200B', { reply_markup: { remove_keyboard: true } });
  } catch (_) {}
}

function formatListingCaption(listing, isPlatinum = false) {
  const parts = [];
  
  // Добавляем значок платины в начало, если есть
  if (isPlatinum) {
    parts.push('💎 Platinum');
  }
  
  // Тип объявления (Куплю/Продам)
  if (listing.type === 'seek') {
    parts.push('🔍 Куплю');
  } else {
    parts.push('💰 Продам');
  }
  
  // Название
  if (listing.title) parts.push(String(listing.title));
  
  
  // Размер (если есть)
  if (listing.size) parts.push(`Размер: ${String(listing.size)}`);
  
  // Цена
  if (listing.price) parts.push(`${String(listing.price)} ₽`);
  
  // Стиль
  if (listing.style) parts.push(String(listing.style));
  
  return parts.join('\n');
}

async function sendListingCard(bot, chatId, listing, ownerOnly = false) {
  // Проверяем, есть ли у автора объявления платина
  const users = await readUsers();
  const authorId = String(listing.userId);
  const author = users[authorId];
  const isPlatinum = author && author.platinum;
  
  const caption = formatListingCaption(listing, isPlatinum);
  const kb = feedReplyKeyboard(ownerOnly);
  try {
    if (Array.isArray(listing.photos) && listing.photos.length > 0) {
      await bot.sendPhoto(chatId, listing.photos[0], { caption, ...kb });
    } else {
      await bot.sendMessage(chatId, caption, kb);
    }
  } catch (_) {
    await bot.sendMessage(chatId, caption, kb);
  }
}

function genderKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👨 Мужской', callback_data: 'gender:male' }],
        [{ text: '👩 Женский', callback_data: 'gender:female' }]
      ]
    }
  };
}

function missingDataKeyboard(missing) {
  const buttons = [];
  
  if (missing.includes('Пол')) {
    buttons.push([
      { text: '👨 Мужской', callback_data: 'missing_gender:male' },
      { text: '👩 Женский', callback_data: 'missing_gender:female' }
    ]);
  }
  
  if (missing.includes('Стиль')) {
    const styles = ['архив', 'кежуал', 'стритвир', 'old money', 'другое'];
    const styleButtons = styles.map(style => ({ text: style, callback_data: `missing_style:${style}` }));
    buttons.push(styleButtons);
  }
  
  if (missing.includes('Цена')) {
    buttons.push([{ text: '💰 Указать цену', callback_data: 'missing_price' }]);
  }
  
  if (missing.includes('Название товара')) {
    buttons.push([{ text: '📝 Указать название', callback_data: 'missing_title' }]);
  }
  
  
  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

function stylesKeyboard() {
  const styles = config.marketBot.styles || [];
  const rows = [];
  for (let i = 0; i < styles.length; i++) {
    rows.push([{ text: styles[i], callback_data: `style:${i}` }]);
  }
  if (rows.length === 0) rows.push([{ text: 'архив', callback_data: 'style:0' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

async function migrateUsersForDedup() {
  try {
    const users = await readUsers();
    let updated = false;
    
    for (const userId in users) {
      const user = users[userId];
      if (user.feed && !Array.isArray(user.feed.seenByContent)) {
        user.feed.seenByContent = [];
        updated = true;
        console.log(`🔧 [MIGRATION] Добавлен seenByContent для пользователя ${userId}`);
      }
    }
    
    if (updated) {
      await writeUsers(users);
      console.log('✅ [MIGRATION] Миграция seenByContent завершена');
    }
  } catch (error) {
    console.error('❌ [MIGRATION] Ошибка миграции seenByContent:', error);
  }
}

// Функция проверки истечения Platinum подписки
async function checkPlatinumExpiration() {
  try {
    const users = await readUsers();
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [userId, user] of Object.entries(users)) {
      if (user.platinum && user.platinumExpiresAt && user.platinumExpiresAt <= now) {
        // Подписка истекла
        user.platinum = false;
        user.platinumExpiredAt = now;
        user.platinumExpiredReason = 'subscription_expired';
        expiredCount++;
        
        console.log(`⏰ Platinum подписка истекла для пользователя ${userId}`);
        
        // Отправляем уведомление пользователю
        try {
          await bot.sendMessage(userId, 
            '⏰ **Уведомление об истечении подписки**\n\n' +
            '💎 Ваша Platinum подписка истекла.\n\n' +
            '✨ Для продления привилегий:\n' +
            '• Перейдите в главное меню\n' +
            '• Нажмите "💎 Platinum"\n' +
            '• Выберите способ оплаты\n\n' +
            'Спасибо за использование наших услуг!',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.log(`Не удалось отправить уведомление об истечении подписки пользователю ${userId}:`, error.message);
        }
      }
    }
    
    if (expiredCount > 0) {
      await writeUsers(users);
      console.log(`⏰ Обработано истекших подписок: ${expiredCount}`);
    }
  } catch (error) {
    console.error('Ошибка при проверке истечения подписок:', error);
  }
}

// Проверяем истечение подписок каждые 6 часов
setInterval(checkPlatinumExpiration, 6 * 60 * 60 * 1000);

// Функция для проверки и обновления Platinum статуса пользователя
async function checkUserPlatinumStatus(userId) {
  try {
    const users = await readUsers();
    const user = users[userId];
    
    if (!user || !user.platinum) {
      return false;
    }
    
    // Проверяем, не истекла ли подписка
    if (user.platinumExpiresAt && user.platinumExpiresAt <= Date.now()) {
      // Подписка истекла
      user.platinum = false;
      user.platinumExpiredAt = Date.now();
      user.platinumExpiredReason = 'subscription_expired';
      await writeUsers(users);
      
      console.log(`⏰ Platinum подписка истекла для пользователя ${userId}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка при проверке Platinum статуса:', error);
    return false;
  }
}

async function start() {
  if (!config.marketBot || !config.marketBot.token || config.marketBot.token === 'YOUR_MARKET_BOT_TOKEN') {
    console.error('Укажите токен бота в config.marketBot.token');
    process.exit(1);
  }

  await ensureDataFiles();
  
  // Миграция: добавляем seenByContent для существующих пользователей
  await migrateUsersForDedup();
  
  const bot = new TelegramBot(config.marketBot.token, { polling: true });

  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Запуск и меню' },
      { command: 'menu', description: 'Главное меню' },
      { command: 'sell', description: 'Создать объявление' },
      { command: 'buy', description: 'Купить' }
    ]);
  } catch (_) {}

  const welcome = `${config.marketBot.description}`;
  
  // Функция для отправки приветственного сообщения с фото
  async function sendWelcomeWithPhoto(chatId) {
    try {
      // Путь к фото (замените на ваш путь к изображению)
      const photoPath = './welcome_photo.png'; // или URL: 'https://example.com/welcome.jpg'
      
      // Проверяем существование файла (только для локальных файлов)
      if (!photoPath.startsWith('http')) {
        const fs = require('fs');
        if (!fs.existsSync(photoPath)) {
          console.log(`Файл ${photoPath} не найден, отправляем обычное сообщение`);
          await bot.sendMessage(chatId, welcome, mainMenuKeyboard());
          return;
        }
      }
      
      // Пытаемся отправить фото с подписью
      await bot.sendPhoto(chatId, photoPath, {
        caption: welcome,
        parse_mode: 'HTML',
        ...mainMenuKeyboard()
      });
      console.log('✓ Приветственное сообщение с фото отправлено успешно');
    } catch (error) {
      console.log('Ошибка отправки фото, отправляем обычное сообщение:', error.message);
      // Если не удалось отправить фото, отправляем обычное сообщение
      await bot.sendMessage(chatId, welcome, { 
        parse_mode: 'HTML',
        ...mainMenuKeyboard() 
      });
    }
  }

  bot.onText(/^\/start|^Начать$/i, async (msg) => {
    const chatId = msg.chat.id;
    const ok = await isUserSubscribed(bot, msg.from.id);
    if (!ok) {
      await bot.sendMessage(chatId, 'Привет, для использования бота нужно подписаться на спонсоров:', subscriptionKeyboard());
      return;
    }
    
    // Проверка блокировки пользователя
    const blocked = await isUserBlocked(msg.from.id);
    if (blocked) {
      await bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
      return;
    }
    
    // Сохраняем данные пользователя при первом обращении
    const users = await readUsers();
    const uid = String(msg.from.id);
    users[uid] = users[uid] || { profile: {}, platinum: false };
    
    if (!users[uid].profile.username) {
      users[uid].profile.username = msg.from.username || 'Неизвестно';
      users[uid].profile.firstName = msg.from.first_name || 'Неизвестно';
      await writeUsers(users);
    }
    
    await sendWelcomeWithPhoto(chatId);
  });

  bot.onText(/^\/menu$/i, async (msg) => {
    const ok = await isUserSubscribed(bot, msg.from.id);
    if (!ok) return bot.sendMessage(msg.chat.id, 'Нужно подписаться:', subscriptionKeyboard());
    await bot.sendMessage(msg.chat.id, 'Главное меню', mainMenuKeyboard());
  });

  bot.onText(/^\/platinum$/i, async (msg) => {
    const ok = await isUserSubscribed(bot, msg.from.id);
    if (!ok) return bot.sendMessage(msg.chat.id, 'Нужно подписаться:', subscriptionKeyboard());
    
    const users = await readUsers();
    const uid = String(msg.from.id);
    const user = users[uid] || { profile: {}, platinum: false };
    
    if (user.platinum) {
      await bot.sendMessage(msg.chat.id, '✨ У вас уже есть привилегия Platinum!\n\nВаши объявления отображаются с приоритетом и значком 💎 Platinum.', mainMenuKeyboard());
      return;
    }
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💎 Купить Платину за 300₽', callback_data: 'platinum_buy' }],
          [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
        ]
      }
    };
    
        await bot.sendMessage(msg.chat.id, 
          '💎 **Привилегия Platinum**\n\n' +
          '✨ **Что дает Platinum:**\n' +
          '• Ваши объявления показываются с приоритетом +30%\n' +
          '• Больше людей увидят ваши объявления\n' +
          '• Специальный значок 💎 Platinum\n' +
          '• Увеличенная видимость в ленте\n\n' +
          '💰 **Стоимость:** 300₽\n' +
          '💳 **Оплата:** Криптовалюта\n\n' +
          'Нажмите кнопку ниже для покупки:', 
          { parse_mode: 'Markdown', ...keyboard }
        );
  });

  bot.onText(/^\/sell$/i, async (msg) => {
    const ok = await isUserSubscribed(bot, msg.from.id);
    if (!ok) return bot.sendMessage(msg.chat.id, 'Нужно подписаться:', subscriptionKeyboard());
    await beginSellFlow(bot, msg.from, msg.chat.id);
  });

  bot.onText(/^\/buy$/i, async (msg) => {
    const ok = await isUserSubscribed(bot, msg.from.id);
    if (!ok) return bot.sendMessage(msg.chat.id, 'Нужно подписаться:', subscriptionKeyboard());
    await bot.sendMessage(msg.chat.id, 'Выберите вариант:', {
      reply_markup: { inline_keyboard: [[{ text: '📰 Лента', callback_data: 'buy_find' }]] }
    });
  });


  bot.on('callback_query', async (q) => {
    // Безопасный ответ на callback query с обработкой ошибок
    const safeAnswerCallback = async (queryId, options = {}) => {
      try {
        await bot.answerCallbackQuery(queryId, options);
      } catch (error) {
        console.log('⚠️ [WARNING] Не удалось ответить на callback query:', error.message);
        // Игнорируем ошибки истечения времени callback query
      }
    };

    if (q.data === 'check_subs') {
      const ok = await isUserSubscribed(bot, q.from.id);
      if (ok) {
        await safeAnswerCallback(q.id, { text: 'Подписки подтверждены!' });
        await sendWelcomeWithPhoto(q.message.chat.id);
      } else {
        await safeAnswerCallback(q.id, { text: 'Не все подписки оформлены.' });
      }
      return;
    }

    // Platinum purchase
    if (q.data === 'platinum_buy') {
      await safeAnswerCallback(q.id);
      
      const users = await readUsers();
      const uid = String(q.from.id);
      users[uid] = users[uid] || { profile: {}, platinum: false };
      
      // Проверяем актуальный статус Platinum (с учетом истечения)
      const hasPlatinum = await checkUserPlatinumStatus(uid);
      if (hasPlatinum) {
        await bot.sendMessage(q.message.chat.id, '✨ У вас уже есть привилегия Platinum!', mainMenuKeyboard());
        return;
      }
      
      // Показываем выбор валюты
      const currencies = cryptoBot.getAvailableCurrencies();
      const keyboard = {
        reply_markup: {
          inline_keyboard: currencies.slice(0, 10).map(currency => [
            { 
              text: `${currency.emoji} ${currency.name} (${currency.amount} ${currency.code})`, 
              callback_data: `platinum_currency_${currency.code}` 
            }
          ]).concat([
            [{ text: '🔄 Обновить курсы', callback_data: 'platinum_refresh_rates' }],
            [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
          ])
        }
      };
      
      await bot.sendMessage(q.message.chat.id, 
        '💎 **Выберите валюту для оплаты**\n\n' +
        '💰 **Стоимость платины:** 300₽\n' +
        '⏰ **Срок действия:** 1 месяц\n\n' +
        '✨ **Что дает Platinum подписка:**\n' +
        '• Приоритетное отображение объявлений +30%\n' +
        '• Больше просмотров и откликов\n' +
        '• Специальный значок 💎 Platinum\n' +
        '• Действует 30 дней с момента покупки\n\n' +
        'Выберите удобную для вас криптовалюту:',
        { parse_mode: 'Markdown', ...keyboard }
      );
      return;
    }

    // Выбор валюты для оплаты
    if (q.data.startsWith('platinum_currency_')) {
      await safeAnswerCallback(q.id);
      
      const currencyCode = q.data.replace('platinum_currency_', '');
      const users = await readUsers();
      const uid = String(q.from.id);
      
      // Создаем счет через CryptoBot с выбранной валютой
      const username = q.from.username || q.from.first_name || 'Пользователь';
      const invoice = await cryptoBot.createPlatinumInvoice(uid, username, currencyCode);
      
      if (!invoice.success) {
        await bot.sendMessage(q.message.chat.id, 
          '❌ **Ошибка создания счета**\n\n' +
          'Не удалось создать счет для оплаты. Попробуйте позже или обратитесь в поддержку.',
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
        return;
      }
      
      // Сохраняем информацию о счете
      users[uid].pendingInvoice = {
        invoiceId: invoice.invoiceId,
        amount: invoice.amount,
        currency: invoice.currency,
        currencyName: invoice.currencyName,
        currencyEmoji: invoice.currencyEmoji,
        amountRub: invoice.amountRub,
        createdAt: Date.now()
      };
      await writeUsers(users);
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Оплатить', url: invoice.payUrl }],
            [{ text: '🔄 Проверить оплату', callback_data: 'platinum_check' }],
            [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
          ]
        }
      };
      
      await bot.sendMessage(q.message.chat.id, 
        `${invoice.currencyEmoji} **Оплата привилегии Platinum**\n\n` +
        `💰 **Сумма:** ${invoice.amount} ${invoice.currency} (${invoice.currencyName})\n` +
        `💵 **Эквивалент:** ≈${invoice.amountRub}₽\n` +
        `🆔 **ID счета:** \`${invoice.invoiceId}\`\n\n` +
        '✨ **Что дает Platinum:**\n' +
        '• Приоритетный показ объявлений +30%\n' +
        '• Больше людей увидят ваши объявления\n' +
        '• Специальный значок 💎 Platinum\n\n' +
        'Нажмите "Оплатить" для перехода к оплате или "Проверить оплату" для проверки статуса.',
        { parse_mode: 'Markdown', ...keyboard }
      );
      return;
    }

    // Обновление курсов валют
    if (q.data === 'platinum_refresh_rates') {
      await safeAnswerCallback(q.id, { text: 'Обновляем курсы валют...' });
      
      const success = await cryptoBot.updateExchangeRates();
      const currencies = cryptoBot.getAvailableCurrencies();
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: currencies.slice(0, 10).map(currency => [
            { 
              text: `${currency.emoji} ${currency.name} (${currency.amount} ${currency.code})`, 
              callback_data: `platinum_currency_${currency.code}` 
            }
          ]).concat([
            [{ text: '🔄 Обновить курсы', callback_data: 'platinum_refresh_rates' }],
            [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
          ])
        }
      };
      
      await bot.sendMessage(q.message.chat.id, 
        '💎 **Выберите валюту для оплаты**\n\n' +
        '💰 **Стоимость платины:** 300₽\n\n' +
        (success ? '✅ **Курсы обновлены!**\n\n' : '⚠️ **Используем кэшированные курсы**\n\n') +
        'Выберите удобную для вас криптовалюту:',
        { parse_mode: 'Markdown', ...keyboard }
      );
      return;
    }

    // Проверка оплаты платины
    if (q.data === 'platinum_check') {
      await safeAnswerCallback(q.id);
      
      const users = await readUsers();
      const uid = String(q.from.id);
      const user = users[uid];
      
      if (!user || !user.pendingInvoice) {
        await bot.sendMessage(q.message.chat.id, 
          '❌ **Счет не найден**\n\n' +
          'У вас нет активного счета для оплаты платины.',
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
        return;
      }
      
      // Проверяем статус счета
      const status = await cryptoBot.checkInvoiceStatus(user.pendingInvoice.invoiceId);
      
      if (!status.success) {
        await bot.sendMessage(q.message.chat.id, 
          '❌ **Ошибка проверки счета**\n\n' +
          'Не удалось проверить статус оплаты. Попробуйте позже.',
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
        return;
      }
      
      if (status.paid) {
        // Оплата прошла успешно - активируем платину
        users[uid].platinum = true;
        users[uid].platinumActivatedAt = Date.now();
        users[uid].platinumExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 дней в миллисекундах
        users[uid].platinumType = 'purchased'; // Тип: purchased (куплено) или granted (выдано модератором)
        delete users[uid].pendingInvoice;
        await writeUsers(users);
        
        await bot.sendMessage(q.message.chat.id, 
          '🎉 **Поздравляем!**\n\n' +
          '💎 Привилегия Platinum активирована!\n' +
          '⏰ **Срок действия:** 30 дней\n\n' +
          '✨ Теперь ваши объявления:\n' +
          '• Отображаются с приоритетом +30%\n' +
          '• Показываются большему количеству людей\n' +
          '• Имеют специальный значок 💎 Platinum\n\n' +
          'Создавайте объявления и получайте больше откликов!', 
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } else {
        // Оплата еще не прошла
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Оплатить', url: `https://t.me/CryptoBot?start=pay-${user.pendingInvoice.invoiceId}` }],
              [{ text: '🔄 Проверить еще раз', callback_data: 'platinum_check' }],
              [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
            ]
          }
        };
        
        const currencyInfo = cryptoBot.supportedCurrencies.find(c => c.code === user.pendingInvoice.currency);
        const currencyEmoji = currencyInfo?.emoji || '💎';
        const currencyName = currencyInfo?.name || user.pendingInvoice.currency;
        
        await bot.sendMessage(q.message.chat.id, 
          `${currencyEmoji} **Ожидание оплаты**\n\n` +
          `💰 **Сумма:** ${user.pendingInvoice.amount} ${user.pendingInvoice.currency} (${currencyName})\n` +
          `💵 **Эквивалент:** ≈${user.pendingInvoice.amountRub || 300}₽\n` +
          `🆔 **ID счета:** \`${user.pendingInvoice.invoiceId}\`\n` +
          `📊 **Статус:** ${status.status}\n\n` +
          'Оплата еще не поступила. Нажмите "Оплатить" для перехода к оплате или "Проверить еще раз" через некоторое время.',
          { parse_mode: 'Markdown', ...keyboard }
        );
      }
      return;
    }

    if (q.data === 'main_menu') {
      await safeAnswerCallback(q.id);
      await bot.sendMessage(q.message.chat.id, 'Главное меню', mainMenuKeyboard());
      return;
    }

    // Buy path
    if (q.data === 'buy_find') {
      await safeAnswerCallback(q.id);
      await bot.sendMessage(q.message.chat.id, 'Выберите пол:', genderKeyboard());
      return;
    }

    // Buy seek path
    if (q.data === 'buy_seek') {
      await safeAnswerCallback(q.id);
      const users = await readUsers();
      const uid = String(q.from.id);
      users[uid] = users[uid] || { profile: {}, platinum: false };
      users[uid].session = { flow: 'seek', step: 'gender', temp: {} };
      await writeUsers(users);
      await bot.sendMessage(q.message.chat.id, 'Создаём объявление о поиске. Выберите пол:', genderKeyboard());
      return;
    }

    if (q.data.startsWith('gender:')) {
      await safeAnswerCallback(q.id);
      const gender = q.data.split(':')[1];
      const genderText = gender === 'male' ? 'мужской' : 'женский';
      
      // Проверяем, если это sell flow
      const users = await readUsers();
      const uid = String(q.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      if (session && session.flow === 'sell' && session.step === 'gender') {
        session.temp = { ...(session.temp || {}), gender };
        session.step = 'title';
        users[uid].session = session;
        await writeUsers(users);
        console.log('🔍 [DEBUG] Выбран пол в сессии sell:', gender, 'genderText:', genderText);
        await bot.sendMessage(q.message.chat.id, `Выбран пол: ${genderText}\n\nНазвание товара:`);
      } else if (session && session.flow === 'seek' && session.step === 'gender') {
        session.temp = { ...(session.temp || {}), gender };
        session.step = 'title';
        users[uid].session = session;
        await writeUsers(users);
        console.log('🔍 [DEBUG] Выбран пол в сессии seek:', gender, 'genderText:', genderText);
        await bot.sendMessage(q.message.chat.id, `Выбран пол: ${genderText}\n\nВведите что ищете:`);
      } else {
        // Это buy flow - сохраняем пол и показываем стили
        users[uid] = users[uid] || { profile: {}, platinum: false };
        users[uid].selectedGender = gender;
        await writeUsers(users);
        console.log('🔍 [DEBUG] Выбран пол в buy flow:', gender, 'genderText:', genderText);
        await bot.sendMessage(q.message.chat.id, `Выбран пол: ${genderText}\n\nВыберите стиль:`, stylesKeyboard());
      }
      return;
    }

    if (q.data.startsWith('style:')) {
      await safeAnswerCallback(q.id);
      const styles = config.marketBot.styles || [];
      const idx = parseInt(q.data.split(':')[1], 10) || 0;
      const style = styles[idx] || 'архив';
      // Если пользователь в процессе создания объявления (sell) и выбирает стиль — не запускаем ленту
      const users = await readUsers();
      const uid = String(q.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      if (session && session.flow === 'sell' && session.step === 'style') {
        session.temp = { ...(session.temp || {}), style };
        session.step = 'price';
        users[uid].session = session;
        await writeUsers(users);
        await bot.sendMessage(q.message.chat.id, '💰 Цена (только число, например: 1500):');
      } else if (session && session.flow === 'seek' && session.step === 'style') {
        session.temp = { ...(session.temp || {}), style };
        session.step = 'price';
        users[uid].session = session;
        await writeUsers(users);
        await bot.sendMessage(q.message.chat.id, '💰 Цена (только число, например: 1500):');
      } else {
        // Это buy flow - передаем стиль и сохраненный пол
        const user = users[uid];
        const filters = { style };
        if (user && user.selectedGender) {
          filters.gender = user.selectedGender;
          console.log('🔍 [DEBUG] Передаем пол в фильтры:', user.selectedGender);
        }
        await startFeedForUser(bot, q.from.id, q.message.chat.id, filters);
      }
      return;
    }


    // Listing interactions
    if (q.data.startsWith('l_yes:')) {
      await safeAnswerCallback(q.id);
      const listingId = q.data.split(':')[1];
      await handleListingYes(bot, q.from, q.message.chat.id, listingId);
      return;
    }
    if (q.data.startsWith('l_no:')) {
      await safeAnswerCallback(q.id);
      await showNextInFeed(bot, q.from.id, q.message.chat.id);
      return;
    }
    if (q.data.startsWith('l_params:')) {
      await safeAnswerCallback(q.id);
      await askFeedParams(bot, q.from.id, q.message.chat.id);
      return;
    }

    // Sell path
    if (q.data === 'sell_create') {
      await safeAnswerCallback(q.id);
      await beginSellFlow(bot, q.from, q.message.chat.id);
      return;
    }

    if (q.data === 'sell_parse') {
      await safeAnswerCallback(q.id);
      await beginParseFlow(bot, q.from, q.message.chat.id);
      return;
    }

    if (q.data === 'parse_forwarded') {
      await safeAnswerCallback(q.id);
      await beginParseFlow(bot, q.from, q.message.chat.id);
      return;
    }

    // Обработка недостающих данных
    if (q.data.startsWith('missing_gender:')) {
      await safeAnswerCallback(q.id);
      const gender = q.data.split(':')[1];
      const users = await readUsers();
      const uid = String(q.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      if (session && session.flow === 'parse' && session.step === 'missing_data') {
        session.temp.gender = gender;
        users[uid].session = session;
        await writeUsers(users);
        
        await bot.sendMessage(q.message.chat.id, `✅ Пол: ${gender === 'male' ? 'мужской' : 'женский'}`);
        
        // Проверяем, все ли данные собраны
        const stillMissing = [];
        if (!session.temp.title) stillMissing.push('Название товара');
        if (!session.temp.price && session.temp.price !== 'SOLD') stillMissing.push('Цена');
        if (!session.temp.gender) stillMissing.push('Пол');
        if (!session.temp.style) stillMissing.push('Стиль');
        
        if (stillMissing.length === 0) {
          // Проверяем, есть ли уже сохраненные фотографии
          const existingPhotos = session.temp.photos || [];
          if (existingPhotos.length > 0) {
            await bot.sendMessage(q.message.chat.id, '✅ Все данные собраны! Фото уже добавлены. Нажмите «Готово» для создания объявления.', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
          } else {
            await bot.sendMessage(q.message.chat.id, '✅ Все данные собраны! Теперь отправьте фото товара.\n\n📸 **Важно:** Отправьте фото как отдельное сообщение, а не как подпись к тексту!', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
          }
          session.step = 'photos';
          users[uid].session = session;
          await writeUsers(users);
        } else {
          await bot.sendMessage(q.message.chat.id, `❓ Осталось указать: ${stillMissing.join(', ')}`, missingDataKeyboard(stillMissing));
        }
      }
      return;
    }

    if (q.data.startsWith('missing_style:')) {
      await safeAnswerCallback(q.id);
      const style = q.data.split(':')[1];
      const users = await readUsers();
      const uid = String(q.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      if (session && session.flow === 'parse' && session.step === 'missing_data') {
        session.temp.style = style;
        users[uid].session = session;
        await writeUsers(users);
        
        await bot.sendMessage(q.message.chat.id, `✅ Стиль: ${style}`);
        
        // Проверяем, все ли данные собраны
        const stillMissing = [];
        if (!session.temp.title) stillMissing.push('Название товара');
        if (!session.temp.price && session.temp.price !== 'SOLD') stillMissing.push('Цена');
        if (!session.temp.gender) stillMissing.push('Пол');
        if (!session.temp.style) stillMissing.push('Стиль');
        
        if (stillMissing.length === 0) {
          // Проверяем, есть ли уже сохраненные фотографии
          const existingPhotos = session.temp.photos || [];
          if (existingPhotos.length > 0) {
            await bot.sendMessage(q.message.chat.id, '✅ Все данные собраны! Фото уже добавлены. Нажмите «Готово» для создания объявления.', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
          } else {
            await bot.sendMessage(q.message.chat.id, '✅ Все данные собраны! Теперь отправьте фото товара.\n\n📸 **Важно:** Отправьте фото как отдельное сообщение, а не как подпись к тексту!', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
          }
          session.step = 'photos';
          users[uid].session = session;
          await writeUsers(users);
        } else {
          await bot.sendMessage(q.message.chat.id, `❓ Осталось указать: ${stillMissing.join(', ')}`, missingDataKeyboard(stillMissing));
        }
      }
      return;
    }


    if (q.data === 'missing_price') {
      await safeAnswerCallback(q.id);
      const users = await readUsers();
      const uid = String(q.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      if (session && session.flow === 'parse' && session.step === 'missing_data') {
        session.step = 'missing_price';
        users[uid].session = session;
        await writeUsers(users);
        
        await bot.sendMessage(q.message.chat.id, '💰 Введите цену (только число, например: 1500):');
      }
      return;
    }

    if (q.data === 'missing_title') {
      await safeAnswerCallback(q.id);
      const users = await readUsers();
      const uid = String(q.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      if (session && session.flow === 'parse' && session.step === 'missing_data') {
        session.step = 'missing_title';
        users[uid].session = session;
        await writeUsers(users);
        
        await bot.sendMessage(q.message.chat.id, '📝 Введите название товара:');
      }
      return;
    }

    if (q.data === 'go_menu') {
      await safeAnswerCallback(q.id);
      await bot.sendMessage(q.message.chat.id, 'Главное меню', mainMenuKeyboard());
      return;
    }

    // My listings menu
    if (q.data.startsWith('my_list:')) {
      await safeAnswerCallback(q.id);
      const page = parseInt(q.data.split(':')[1] || '0', 10) || 0;
      await showMyListingsMenu(bot, q.from.id, q.message.chat.id, page);
      return;
    }
    if (q.data.startsWith('my_view:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await showMyListing(bot, q.from.id, q.message.chat.id, id);
      return;
    }
    if (q.data.startsWith('my_del:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await deleteMyListing(bot, q.from.id, q.message.chat.id, id);
      return;
    }
    if (q.data.startsWith('my_edit:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await editMyListing(bot, q.from.id, q.message.chat.id, id);
      return;
    }
    
    // Обработчики редактирования объявлений
    if (q.data.startsWith('edit_title:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await startEditField(bot, q.from.id, q.message.chat.id, id, 'title');
      return;
    }
    if (q.data.startsWith('edit_price:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await startEditField(bot, q.from.id, q.message.chat.id, id, 'price');
      return;
    }
    if (q.data.startsWith('edit_description:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await startEditField(bot, q.from.id, q.message.chat.id, id, 'description');
      return;
    }
    if (q.data.startsWith('edit_photos:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await startEditField(bot, q.from.id, q.message.chat.id, id, 'photos');
      return;
    }
    if (q.data.startsWith('edit_gender:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await startEditField(bot, q.from.id, q.message.chat.id, id, 'gender');
      return;
    }
    if (q.data.startsWith('edit_style:')) {
      await safeAnswerCallback(q.id);
      const id = q.data.split(':')[1];
      await startEditField(bot, q.from.id, q.message.chat.id, id, 'style');
      return;
    }
    
    // Обработчики для установки значений при редактировании
    if (q.data.startsWith('edit_gender_set:')) {
      await safeAnswerCallback(q.id);
      const parts = q.data.split(':');
      const id = parts[1];
      const gender = parts[2];
      await updateListingField(bot, q.from.id, q.message.chat.id, id, 'gender', gender);
      return;
    }
    if (q.data.startsWith('edit_style_set:')) {
      await safeAnswerCallback(q.id);
      const parts = q.data.split(':');
      const id = parts[1];
      const style = parts[2];
      await updateListingField(bot, q.from.id, q.message.chat.id, id, 'style', style);
      return;
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    console.log('🔍 [DEBUG] bot.on("message") вызван:', {
      userId: msg.from.id,
      hasText: !!msg.text,
      hasCaption: !!msg.caption,
      hasPhotos: !!msg.photo,
      isForwarded: !!msg.forward_from,
      photoCount: msg.photo?.length
    });
    
    // Флаг для предотвращения дублирования обработки
    if (msg._processed) {
      console.log('🔍 [DEBUG] Сообщение уже обработано');
      return;
    }
    
    // Получаем сессию пользователя для обработки фото
    const users = await readUsers();
    const uid = String(msg.from.id);
    const session = users[uid] && users[uid].session ? users[uid].session : null;
    
    // Проверяем, редактирует ли пользователь объявление
    if (users[uid] && users[uid].editingListing) {
      const editing = users[uid].editingListing;
      const field = editing.field;
      const listingId = editing.id;
      
      // Обработка текстовых полей
      if (msg.text && (field === 'title' || field === 'price' || field === 'description')) {
        await updateListingField(bot, msg.from.id, msg.chat.id, listingId, field, msg.text.trim());
        return;
      }
      
      // Обработка фото
      if (msg.photo && field === 'photos') {
        const sizes = msg.photo || [];
        const best = sizes[sizes.length - 1];
        
        // Инициализируем массив фото для редактирования, если его нет
        if (!users[uid].editingPhotos) {
          users[uid].editingPhotos = [];
        }
        
        users[uid].editingPhotos.push(best.file_id);
        await writeUsers(users);
        
        const photoCount = users[uid].editingPhotos.length;
        const maxPhotos = 5;
        
        if (photoCount >= maxPhotos) {
          await bot.sendMessage(msg.chat.id, `📸 Фото добавлено (${photoCount}/${maxPhotos}). Максимум достигнут. Нажмите «Готово» для сохранения.`, { 
            reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
          });
        } else {
          await bot.sendMessage(msg.chat.id, `📸 Фото добавлено (${photoCount}/${maxPhotos}). Отправьте ещё фото или нажмите «Готово».`, { 
            reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
          });
        }
        return;
      }
      
      // Обработка кнопки "Готово" для фото
      if (msg.text && (msg.text === '✅ Готово' || msg.text === 'Готово') && field === 'photos') {
        if (users[uid].editingPhotos && users[uid].editingPhotos.length > 0) {
          await updateListingField(bot, msg.from.id, msg.chat.id, listingId, 'photos', users[uid].editingPhotos);
          // Очищаем временные фото
          delete users[uid].editingPhotos;
          await writeUsers(users);
        } else {
          await bot.sendMessage(msg.chat.id, '❌ Нет фото для сохранения. Отправьте хотя бы одно фото.');
        }
        return;
      }
    }
    
    // Устанавливаем флаг _processed для сообщений с фото сразу, чтобы предотвратить дублирование
    if (msg.photo && msg.photo.length > 0) {
      msg._processed = true;
    }
    
    // Обработка фото в bot.on("message") для sell/seek/parse flows (ПЕРЕД установкой флага)
    if (session && msg.photo && msg.photo.length > 0 && 
        (session.flow === 'sell' || session.flow === 'seek' || session.flow === 'parse') && 
        session.step === 'photos') {
      
      console.log('🔍 [DEBUG] Обработка фото в bot.on("message") для sell flow');
      const sizes = msg.photo || [];
      const best = sizes[sizes.length - 1];
      session.temp.photos = session.temp.photos || [];
      session.temp.photos.push(best.file_id);
      
      console.log('🔍 [DEBUG] Фото добавлено в сессию в bot.on("message"):', session.temp.photos);
      console.log('🔍 [DEBUG] Количество фото в сессии:', session.temp.photos.length);
      
      users[uid].session = session;
      await writeUsers(users);
      
      const photoCount = session.temp.photos.length;
      const maxPhotos = 5;
      if (photoCount >= maxPhotos) {
        await bot.sendMessage(msg.chat.id, `📸 Фото добавлено (${photoCount}/${maxPhotos}). Максимум достигнут. Нажмите «Готово» для создания объявления.`, { 
          reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
        });
      } else {
        await bot.sendMessage(msg.chat.id, `📸 Фото добавлено (${photoCount}/${maxPhotos}). Отправьте ещё фото или нажмите «Готово».`, { 
          reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
        });
      }
      
      return;
    }
    
    // Устанавливаем флаг _processed для остальных сообщений
    if (!msg.photo || msg.photo.length === 0) {
      msg._processed = true;
    }
    
    // Обработка пересланных сообщений для parse flow
    if (msg.forward_from) {
      console.log('🔍 [DEBUG] Пересланное сообщение получено:', {
        userId: msg.from.id,
        text: msg.text,
        caption: msg.caption,
        forwardFrom: msg.forward_from,
        hasText: !!msg.text,
        hasCaption: !!msg.caption,
        hasPhotos: !!msg.photo,
        photoCount: msg.photo?.length
      });
      console.log('🔍 [DEBUG] Пересланное сообщение - msg.photo:', msg.photo);
      console.log('🔍 [DEBUG] Пересланное сообщение - JSON.stringify(msg.photo):', JSON.stringify(msg.photo, null, 2));
      
      const users = await readUsers();
      const uid = String(msg.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      console.log('🔍 [DEBUG] Сессия пользователя:', {
        session: session,
        flow: session?.flow,
        step: session?.step
      });
      
      if (session && session.flow === 'parse' && session.step === 'text') {
        // Используем текст или подпись для парсинга
        const textToParse = msg.text || msg.caption;
        console.log('🔍 [DEBUG] Текст для парсинга:', textToParse);
        
        if (textToParse) {
          const modifiedMsg = { ...msg, text: textToParse };
          
          // Сохраняем фото если есть
          if (msg.photo && msg.photo.length > 0) {
            // Инициализируем массив фото если его нет
            session.temp.photos = session.temp.photos || [];
            
            // Берем самое качественное фото (последнее в массиве) - это разные размеры одного фото
            const bestPhoto = msg.photo[msg.photo.length - 1];
            
            // Проверяем, не сохранили ли мы уже это фото (по file_id)
            const photoExists = session.temp.photos.includes(bestPhoto.file_id);
            
            if (!photoExists) {
              session.temp.photos.push(bestPhoto.file_id);
              console.log('🔍 [DEBUG] Добавлено новое фото в сессию:', bestPhoto.file_id);
            } else {
              console.log('🔍 [DEBUG] Фото уже существует в сессии, пропускаем:', bestPhoto.file_id);
            }
            
            console.log('🔍 [DEBUG] Все фото в сессии:', session.temp.photos);
            console.log('🔍 [DEBUG] Количество фото в оригинале:', msg.photo.length);
            console.log('🔍 [DEBUG] Выбрано лучшее фото:', bestPhoto.file_id);
            console.log('🔍 [DEBUG] Общее количество фото в сессии:', session.temp.photos.length);
            
            // Сохраняем изменения в сессии
            users[uid].session = session;
            await writeUsers(users);
          }
          
          // Обрабатываем пересланное сообщение как обычный текст
          const handled = await handleSessionMessage(bot, modifiedMsg, session, users);
          console.log('🔍 [DEBUG] Результат обработки:', handled);
          
          if (handled) {
            await writeUsers(users);
            return;
          }
        } else {
          console.log('🔍 [DEBUG] Нет текста или подписи для парсинга');
          // Не показываем ошибку, просто пропускаем
          return;
        }
      } else {
        console.log('🔍 [DEBUG] Сессия не подходит для парсинга');
        // Если пользователь не в режиме парсинга, но отправил пересланное сообщение
        // Сохраняем текст и фото для последующего парсинга
        const users = await readUsers();
        const uid = String(msg.from.id);
        users[uid] = users[uid] || { profile: {}, platinum: false };
        
        // Сохраняем текст если есть
        if (msg.text || msg.caption) {
          users[uid].forwardedText = msg.text || msg.caption;
        }
        
        // Сохраняем фото если есть
        if (msg.photo && msg.photo.length > 0) {
          // Инициализируем массив фото если его нет
          users[uid].forwardedPhotos = users[uid].forwardedPhotos || [];
          
          // Берем самое качественное фото (последнее в массиве) - это разные размеры одного фото
          const bestPhoto = msg.photo[msg.photo.length - 1];
          
          // Проверяем, не сохранили ли мы уже это фото (по file_id)
          const photoExists = users[uid].forwardedPhotos.includes(bestPhoto.file_id);
          
          if (!photoExists) {
            users[uid].forwardedPhotos.push(bestPhoto.file_id);
            console.log('🔍 [DEBUG] Добавлено новое фото из пересланного сообщения:', bestPhoto.file_id);
          } else {
            console.log('🔍 [DEBUG] Фото уже существует, пропускаем:', bestPhoto.file_id);
          }
          
          console.log('🔍 [DEBUG] Все сохраненные фото из пересланных сообщений:', users[uid].forwardedPhotos);
          console.log('🔍 [DEBUG] Количество фото в оригинале:', msg.photo.length);
          console.log('🔍 [DEBUG] Выбрано лучшее фото:', bestPhoto.file_id);
          console.log('🔍 [DEBUG] Общее количество сохраненных фото:', users[uid].forwardedPhotos.length);
        } else {
          console.log('🔍 [DEBUG] В пересланном сообщении нет фото');
          console.log('🔍 [DEBUG] msg.photo:', msg.photo);
          // НЕ очищаем массив фото, так как могут быть другие фото в других сообщениях
        }
        
        await writeUsers(users);
        
        console.log('🔍 [DEBUG] После сохранения - forwardedPhotos:', users[uid].forwardedPhotos);
        console.log('🔍 [DEBUG] После сохранения - количество forwardedPhotos:', users[uid].forwardedPhotos?.length || 0);
        
        // Показываем кнопку только если есть текст для парсинга
        if (msg.text || msg.caption) {
          await bot.sendMessage(chatId, 
            '📝 Вы отправили пересланное объявление!\n\n' +
            'Хотите автоматически извлечь из него данные? Нажмите кнопку ниже:',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📝 Парсить объявление', callback_data: 'parse_forwarded' }]
                ]
              }
            }
          );
        }
        return; // Добавляем return чтобы избежать дублирования
      }
    }
    
    // Обработка сообщений с подписью для parse flow
    if (msg.caption && !msg.text) {
      const users = await readUsers();
      const uid = String(msg.from.id);
      const session = users[uid] && users[uid].session ? users[uid].session : null;
      
      console.log('🔍 [DEBUG] Сообщение с подписью получено:', {
        userId: msg.from.id,
        caption: msg.caption,
        hasPhotos: !!msg.photo,
        session: session?.flow,
        step: session?.step
      });
      
      if (session && session.flow === 'parse' && session.step === 'text') {
        // Используем подпись для парсинга
        const modifiedMsg = { ...msg, text: msg.caption };
        
        // Сохраняем фото перед обработкой
        if (msg.photo && msg.photo.length > 0) {
          // Сохраняем все фото, а не только последнее
          session.temp.photos = session.temp.photos || [];
          msg.photo.forEach(photo => {
            session.temp.photos.push(photo.file_id);
          });
          console.log('🔍 [DEBUG] Сохранены все фото в сессии перед обработкой:', session.temp.photos);
          console.log('🔍 [DEBUG] Количество сохраненных фото:', session.temp.photos.length);
          users[uid].session = session;
          await writeUsers(users);
        }
        
        const handled = await handleSessionMessage(bot, modifiedMsg, session, users);
        console.log('🔍 [DEBUG] Результат обработки подписи:', handled);
        
        if (handled) {
          await writeUsers(users);
          return;
        }
      } else {
        // Если пользователь не в режиме парсинга, но отправил сообщение с подписью
        const users = await readUsers();
        const uid = String(msg.from.id);
        users[uid] = users[uid] || { profile: {}, platinum: false };
        users[uid].forwardedText = msg.caption;
        
        // Сохраняем фото если есть
        if (msg.photo && msg.photo.length > 0) {
          // Берем самое качественное фото (последнее в массиве)
          const bestPhoto = msg.photo[msg.photo.length - 1];
          // Если уже есть сохраненные фото, добавляем к ним, иначе создаем новый массив
          users[uid].forwardedPhotos = users[uid].forwardedPhotos || [];
          users[uid].forwardedPhotos.push(bestPhoto.file_id);
          console.log('🔍 [DEBUG] Сохранены фото из сообщения с подписью (parse flow):', users[uid].forwardedPhotos);
          console.log('🔍 [DEBUG] Количество фото в оригинале:', msg.photo.length);
          console.log('🔍 [DEBUG] Выбрано лучшее фото:', bestPhoto.file_id);
        } else {
          console.log('🔍 [DEBUG] В сообщении с подписью нет фото (parse flow)');
          users[uid].forwardedPhotos = [];
        }
        
        await writeUsers(users);
        return; // Добавляем return чтобы избежать дублирования
      }
    }
    
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return; // избегаем дублей с onText-командами

    // Gate on every message
    const ok = await isUserSubscribed(bot, msg.from.id);
    if (!ok) {
      await bot.sendMessage(chatId, 'Привет, для использования бота нужно подписаться на спонсоров:', subscriptionKeyboard());
      return;
    }
    
    // Проверка блокировки пользователя
    const blocked = await isUserBlocked(msg.from.id);
    if (blocked) {
      await bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
      return;
    }

    const text = msg.text.trim();

    // Session-driven flows (sell, feed-params)
    // users, uid, and session are already defined above

    // Главные кнопки имеют приоритет над любыми сессиями
    if (/^(🛒 Купить|💰 Продать|📋 Мои объявления|💎 Platinum|Купить|Продать|Мои объявления|Platinum)$/i.test(text)) {
      if (session) {
        users[uid].session = null;
        await writeUsers(users);
      }
      await hideReplyKeyboard(bot, chatId);
      if (/^🛒\s*Купить$/i.test(text) || /^Купить$/i.test(text)) {
        const kb = { 
          reply_markup: { 
            inline_keyboard: [
              [{ text: '📰 Лента', callback_data: 'buy_find' }],
              [{ text: '🔍 Ищу предмет', callback_data: 'buy_seek' }]
            ] 
          } 
        };
        await bot.sendMessage(chatId, 'Выберите вариант:', kb);
        return;
      }
      if (/^💰\s*Продать$/i.test(text) || /^Продать$/i.test(text)) {
        const kb = { 
          reply_markup: { 
            inline_keyboard: [
              [{ text: '➕ Создать объявление', callback_data: 'sell_create' }],
              [{ text: '📝 Отправить готовое объявление', callback_data: 'sell_parse' }]
            ] 
          } 
        };
        await bot.sendMessage(chatId, 'Выберите действие:', kb);
        return;
      }
      if (/^📋\s*Мои\s*объявления$/i.test(text) || /^Мои\s*объявления$/i.test(text)) {
        const listings = await readListings();
        const mine = listings.filter(l => String(l.userId) === String(msg.from.id));
        if (mine.length === 0) {
          await bot.sendMessage(chatId, 'У вас пока нет объявлений.', mainMenuKeyboard());
          return;
        }
        // Сразу меняем клавиатуру на сон
        await setSleepKeyboard(bot, chatId);
        await showMyListingsMenu(bot, msg.from.id, chatId, 0);
        return;
      }
      if (/^💎\s*Platinum$/i.test(text) || /^Platinum$/i.test(text)) {
        const user = users[uid] || { profile: {}, platinum: false };
        
        if (user.platinum) {
          await bot.sendMessage(chatId, '✨ У вас уже есть привилегия Platinum!\n\nВаши объявления отображаются с приоритетом +30% и значком 💎 Platinum.', mainMenuKeyboard());
          return;
        }
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💎 Купить Platinum за 300₽', callback_data: 'platinum_buy' }],
              [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
            ]
          }
        };
        
        await bot.sendMessage(chatId, 
          '💎 **Привилегия Platinum**\n\n' +
          '✨ **Что дает Platinum:**\n' +
          '• Ваши объявления показываются с приоритетом +30%\n' +
          '• Больше людей увидят ваши объявления\n' +
          '• Специальный значок 💎 Platinum\n' +
          '• Увеличенная видимость в ленте\n\n' +
          '💰 **Стоимость:** 300₽\n' +
          '💳 **Оплата:** Криптовалюта\n\n' +
          'Нажмите кнопку ниже для покупки:', 
          { parse_mode: 'Markdown', ...keyboard }
        );
        return;
      }
    }

    // Feed controls via reply keyboard
    if (text === '👎' || text === '🚀') {
      const feed = users[uid] && users[uid].feed ? users[uid].feed : null;
      if (feed && feed.filters && feed.filters.ownerOnly) return; // в "Мои объявления" листать нельзя
      
      // Помечаем текущее объявление как просмотренное перед переходом
      if (feed && feed.list && feed.list.length > 0) {
        const currentId = feed.list[feed.index] || feed.list[0];
        feed.seen = feed.seen || [];
        if (!feed.seen.includes(currentId)) {
          feed.seen.push(currentId);
          console.log('👎/🚀 [DEBUG] Помечаем как просмотренное:', currentId);
        }
        users[uid].feed = feed;
        await writeUsers(users);
      }
      
      await showNextInFeed(bot, msg.from.id, chatId);
      // после перехода всегда сбрасываем режим и ставим базовую клавиатуру
      const u = await readUsers();
      const uid2 = String(msg.from.id);
      const usr = u[uid2] || {};
      if (usr.feed) usr.feed.mode = null;
      u[uid2] = usr;
      await writeUsers(u);
      try { await bot.sendMessage(chatId, '\u200B', feedReplyKeyboard(false, false)); } catch (_) {}
      return;
    }
    if (text === 'Сон' || text === '💤') {
      // exit feed and show main menu
      users[uid] = users[uid] || {};
      users[uid].feed = users[uid].feed || null;
      users[uid].session = null; // Выход из любой сессии
      await writeUsers(users);
      await bot.sendMessage(chatId, 'Главное меню', { reply_markup: mainMenuKeyboard().reply_markup });
      return;
    }
    if (text === '❤️' || text === '❤') {
      console.log('💖 [DEBUG] Лайк получен от:', uid, 'chatId:', chatId);
      let feed = users[uid] && users[uid].feed ? users[uid].feed : null;
      if (feed && feed.filters && feed.filters.ownerOnly) return; // в "Мои объявления" нельзя контакт/лайк
      // contact seller for current listing
      const listings = await readListings();
      if (!feed || !Array.isArray(feed.list) || feed.list.length === 0) {
        await bot.sendMessage(chatId, 'Лента пуста.', mainMenuKeyboard());
        return;
      }
      const listingId = feed.list[feed.index] || feed.list[0];
      const listing = listings.find(l => l.id === listingId);
      if (!listing) {
        await bot.sendMessage(chatId, 'Объявление не найдено.', mainMenuKeyboard());
        return;
      }
      const seller = listing.username || String(listing.userId);
      // Сообщение с inline-кнопками (Связаться / Легитчек)
      if (listing.username) {
        await bot.sendMessage(chatId, 'Связаться с продавцом:', {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💬 Связаться', url: `https://t.me/${listing.username.replace('@','')}` },
                { text: '🛡️ Легитчек', url: 'https://t.me/kokc5' }
              ],
              [
                { text: '🛡️ Гарант', url: 'https://t.me/ranjiroakim' },
                { text: '🔍 Найти', url: 'https://t.me/morgenrg' }
              ]
            ]
          }
        });
      } else {
        await bot.sendMessage(chatId, `Связаться с продавцом: ${seller}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🛡️ Легитчек', url: 'https://t.me/kokc5' },
                { text: '🛡️ Гарант', url: 'https://t.me/ranjiroakim' }
              ],
              [
                { text: '🔍 Найти', url: 'https://t.me/morgenrg' }
              ]
            ]
          }
        });
      }
      
      // Помечаем текущее объявление как просмотренное перед переходом к следующему
      console.log('💖 [DEBUG] Текущее объявление ID:', listingId);
      console.log('💖 [DEBUG] Текущий массив seen:', feed.seen);
      if (feed && feed.seen) {
        if (!feed.seen.includes(listingId)) {
          feed.seen.push(listingId);
          console.log('💖 [DEBUG] Добавили в seen:', listingId);
        } else {
          console.log('💖 [DEBUG] Уже было в seen:', listingId);
        }
      } else if (feed) {
        feed.seen = [listingId];
        console.log('💖 [DEBUG] Создали новый seen:', feed.seen);
      }
      users[uid].feed = feed;
      await writeUsers(users);
      console.log('💖 [DEBUG] Сохранили users с seen:', feed.seen);
      
      // Обновляем reply-клавиатуру с ракетой и понятным текстом
      console.log('💖 [DEBUG] Обновляем клавиатуру с ракетой...');
      await bot.sendMessage(chatId, 'Нажмите 🚀 чтобы увидеть новое объявление', feedReplyKeyboard(false, true));
      
      // Сохраняем режим post_like в состоянии пользователя
      const u = users[uid] || {};
      u.feed = u.feed || {};
      u.feed.mode = 'post_like';
      users[uid] = u;
      await writeUsers(users);
      console.log('💖 [DEBUG] Режим post_like сохранен');
      return;
    }

    if (session) {
      const handled = await handleSessionMessage(bot, msg, session, users);
      if (handled) {
        await writeUsers(users);
        return;
      }
    }

    if (/^🛒 Купить$/i.test(text) || /^Купить$/i.test(text)) {
      const kb = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📰 Лента', callback_data: 'buy_find' }],
            [{ text: '🔍 Ищу предмет', callback_data: 'buy_seek' }]
          ]
        }
      };
      await bot.sendMessage(chatId, 'Выберите вариант:', kb);
    } else if (/^💰 Продать$/i.test(text) || /^Продать$/i.test(text)) {
      const kb = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Создать объявление', callback_data: 'sell_create' }],
          ]
        }
      };
      await bot.sendMessage(chatId, 'Выберите действие:', kb);
    }
  });

  // Capture photos for sell flow and parse flow
  bot.on('photo', async (msg) => {
    console.log('🔍 [DEBUG] Получено фото от пользователя:', msg.from.id);
    console.log('🔍 [DEBUG] msg.photo:', msg.photo);
    
    // Проверяем, не обработано ли уже сообщение в bot.on('message')
    if (msg._processed) {
      console.log('🔍 [DEBUG] Сообщение с фото уже обработано в bot.on("message")');
      return;
    }
    
    console.log('🔍 [DEBUG] Обработчик фото вызван:', {
      userId: msg.from.id,
      hasCaption: !!msg.caption,
      caption: msg.caption,
      hasPhotos: !!msg.photo,
      photoCount: msg.photo?.length,
      isForwarded: !!msg.forward_from
    });
    
    // Если это пересланное сообщение, не обрабатываем здесь - пусть обработается в bot.on('message')
    if (msg.forward_from) {
      console.log('🔍 [DEBUG] Пересланное сообщение с фото - пропускаем обработку в bot.on("photo")');
      console.log('🔍 [DEBUG] Пересланное сообщение - forward_from:', msg.forward_from);
      console.log('🔍 [DEBUG] Пересланное сообщение - hasPhotos:', !!msg.photo);
      console.log('🔍 [DEBUG] Пересланное сообщение - photoCount:', msg.photo?.length);
      return;
    }
    
    console.log('🔍 [DEBUG] Обработка фото в bot.on("photo") - не пересланное сообщение');
    
    const users = await readUsers();
    const uid = String(msg.from.id);
    const session = users[uid] && users[uid].session ? users[uid].session : null;
    
    console.log('🔍 [DEBUG] Фото получено:', {
      userId: msg.from.id,
      session: session?.flow,
      step: session?.step,
      hasCaption: !!msg.caption
    });
    
    // Если пользователь в режиме парсинга и отправляет фото с подписью на шаге 'text'
    if (session && session.flow === 'parse' && session.step === 'text' && msg.caption) {
      console.log('🔍 [DEBUG] Парсинг подписи к фото:', msg.caption);
      
      const parsed = parseListingText(msg.caption);
      // Сохраняем существующие фотографии, если они есть
      const existingPhotos = session.temp.photos || [];
      
      // Берем самое качественное фото (последнее в массиве) - это разные размеры одного фото
      const bestPhoto = msg.photo[msg.photo.length - 1];
      
      // Проверяем, не сохранили ли мы уже это фото (по file_id)
      const photoExists = existingPhotos.includes(bestPhoto.file_id);
      
      if (!photoExists) {
        existingPhotos.push(bestPhoto.file_id);
        console.log('🔍 [DEBUG] Добавлено новое фото с подписью:', bestPhoto.file_id);
      } else {
        console.log('🔍 [DEBUG] Фото с подписью уже существует, пропускаем:', bestPhoto.file_id);
      }
      
      session.temp = { ...parsed, photos: existingPhotos };
      console.log('🔍 [DEBUG] В обработчике фото с подписью - сохранены существующие фото:', existingPhotos);
      console.log('🔍 [DEBUG] В обработчике фото с подписью - итоговые фото в session.temp:', session.temp.photos);
      console.log('🔍 [DEBUG] В обработчике фото с подписью - количество фото:', session.temp.photos.length);
      
      // Сохраняем изменения в сессии
      users[uid].session = session;
      await writeUsers(users);
      
      console.log('🔍 [DEBUG] После сохранения - session.temp.photos:', session.temp.photos);
      console.log('🔍 [DEBUG] После сохранения - количество фото:', session.temp.photos.length);
      
      // Показываем что удалось извлечь
      let response = '📝 **Извлеченные данные из подписи к фото:**\n\n';
      
      if (parsed.title) response += `✅ Название: ${parsed.title}\n`;
      if (parsed.price) response += `✅ Цена: ${parsed.price}${parsed.price === 'SOLD' ? '' : '₽'}\n`;
      if (parsed.size) response += `✅ Размер: ${parsed.size}\n`;
      if (parsed.gender) response += `✅ Пол: ${parsed.gender === 'male' ? 'мужской' : 'женский'}\n`;
      if (parsed.style) response += `✅ Стиль: ${parsed.style}\n`;
      if (parsed.description) response += `✅ Описание: ${parsed.description}\n`;
      
      response += '\n❓ **Недостающие данные:**\n';
      
      const missing = [];
      if (!parsed.title) missing.push('Название товара');
      if (!parsed.price && parsed.price !== 'SOLD') missing.push('Цена');
      if (!parsed.gender) missing.push('Пол');
      if (!parsed.style) missing.push('Стиль');
      
      if (missing.length === 0) {
        response += '✅ Все данные извлечены! Фото добавлено. Нажмите «Готово» для создания объявления.';
        session.step = 'photos';
        // Фото уже добавлены выше в existingPhotos
        await bot.sendMessage(msg.chat.id, response, { 
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true }
        });
      } else {
        response += missing.map(item => `• ${item}`).join('\n');
        response += '\n\nВыберите недостающие данные:';
        session.step = 'missing_data';
        // Фото уже добавлены выше в existingPhotos
        await bot.sendMessage(msg.chat.id, response, { 
          parse_mode: 'Markdown',
          ...missingDataKeyboard(missing)
        });
      }
      
      users[uid].session = session;
      await writeUsers(users);
      return;
    }
    
    // Если пользователь в режиме парсинга и отправляет фото БЕЗ подписи на шаге 'photos' или 'text'
    if (session && session.flow === 'parse' && (session.step === 'photos' || session.step === 'text') && !msg.caption) {
      console.log('🔍 [DEBUG] Добавляем фото к объявлению');
      
      const sizes = msg.photo || [];
      if (sizes.length === 0) return;
      // Сохраняем все фото, а не только последнее
      session.temp.photos = session.temp.photos || [];
      sizes.forEach(photo => {
        session.temp.photos.push(photo.file_id);
      });
      users[uid].session = session;
      await writeUsers(users);
      
      console.log('🔍 [DEBUG] Фото добавлено в сессию:', session.temp.photos);
      console.log('🔍 [DEBUG] Количество фото в сессии:', session.temp.photos.length);
      
      // Если это шаг 'text', переходим к шагу 'photos'
      if (session.step === 'text') {
        session.step = 'photos';
        users[uid].session = session;
        await writeUsers(users);
        console.log('🔍 [DEBUG] Переход на шаг photos - session.temp.photos:', session.temp.photos);
      }
      
      return; // Важно! Прерываем выполнение, чтобы не обрабатывать дальше
      
      const photoCount = session.temp.photos.length;
      const maxPhotos = 5;
      if (photoCount >= maxPhotos) {
        await bot.sendMessage(msg.chat.id, `📸 Фото добавлено (${photoCount}/${maxPhotos}). Максимум достигнут. Нажмите «Готово» для создания объявления.`, { 
          reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
        });
      } else {
        await bot.sendMessage(msg.chat.id, `📸 Фото добавлено (${photoCount}/${maxPhotos}). Отправьте ещё фото или нажмите «Готово».`, { 
          reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
        });
      }
      return;
    }
    
    // Если пользователь НЕ в режиме парсинга, но отправил фото с подписью
    if (!session && msg.caption) {
      console.log('🔍 [DEBUG] Пользователь не в режиме парсинга, но отправил фото с подписью');
      
      const users = await readUsers();
      const uid = String(msg.from.id);
      users[uid] = users[uid] || { profile: {}, platinum: false };
      users[uid].forwardedText = msg.caption;
      
      // Сохраняем фото если есть
      if (msg.photo && msg.photo.length > 0) {
        // Берем самое качественное фото (последнее в массиве)
        const bestPhoto = msg.photo[msg.photo.length - 1];
        // Если уже есть сохраненные фото, добавляем к ним, иначе создаем новый массив
        users[uid].forwardedPhotos = users[uid].forwardedPhotos || [];
        users[uid].forwardedPhotos.push(bestPhoto.file_id);
        console.log('🔍 [DEBUG] Сохранены фото из сообщения с подписью:', users[uid].forwardedPhotos);
        console.log('🔍 [DEBUG] Количество фото в оригинале:', msg.photo.length);
        console.log('🔍 [DEBUG] Выбрано лучшее фото:', bestPhoto.file_id);
      } else {
        console.log('🔍 [DEBUG] В сообщении с подписью нет фото');
        users[uid].forwardedPhotos = [];
      }
      
      await writeUsers(users);
      
      await bot.sendMessage(msg.chat.id, 
        '📝 Вы отправили фото с подписью!\n\n' +
        'Хотите автоматически извлечь из него данные? Нажмите кнопку ниже:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Парсить объявление', callback_data: 'parse_forwarded' }]
            ]
          }
        }
      );
      return;
    }
    
    // Обычная обработка фото для sell/seek/parse flows на шаге 'photos'
    // ОТКЛЮЧЕНО: эта логика дублирует bot.on('message') и вызывает дублирование сообщений
    // Вся обработка фото теперь происходит только в bot.on('message')
    console.log('🔍 [DEBUG] Обработка фото в bot.on("photo") отключена для предотвращения дублирования');
    return;
  });
}

start().catch((e) => {
  console.error('Ошибка запуска бота:', e);
  process.exit(1);
});


async function handleSessionMessage(bot, msg, session, users) {
  const uid = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text || '';

  if (session.flow === 'sell') {
    switch (session.step) {
      case 'gender':
        // Ожидаем на этом шаге только callback-кнопки, игнорируем текст
        await bot.sendMessage(chatId, 'Выберите пол:', genderKeyboard());
        return true;
      case 'title':
        session.temp = { ...(session.temp||{}), title: text };
        session.step = 'style';
        await bot.sendMessage(chatId, 'Выберите стиль:', stylesKeyboard());
        break;
      case 'price':
        {
          const normalized = String(text).replace(/\s+/g, '').replace(',', '.');
          const valid = /^\d+(?:[\.,]?\d{0,2})?$/.test(text);
          const validNormalized = /^\d+(?:\.\d{0,2})?$/.test(normalized);
          if (!valid && !validNormalized) {
            await bot.sendMessage(chatId, '❌ Введите цену только числом!\n\nПримеры: 1500, 1999.99, 2500');
            return true;
          }
          session.temp.price = validNormalized ? normalized : text;
          session.step = 'description';
          await bot.sendMessage(chatId, '📝 Короткое описание:');
        }
        break;
      case 'description':
        session.temp.description = text;
        session.step = 'photos';
        await bot.sendMessage(chatId, '📸 Отправьте 1-5 фото товара (обязательно минимум 1 фото). Когда закончите — нажмите «Готово».', { reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } });
        break;
      case 'photos':
        if (/^(готово|готов|done|завершить)$/i.test(text) || /^✅ Готово$/i.test(text)) {
          // Проверяем, что загружено хотя бы одно фото
          const photos = session.temp.photos || [];
          console.log('🔍 [DEBUG] Обработка кнопки Готово в sell flow - фото в сессии:', photos);
          console.log('🔍 [DEBUG] Количество фото в сессии:', photos.length);
          console.log('🔍 [DEBUG] session.temp:', session.temp);
          console.log('🔍 [DEBUG] session.step:', session.step);
          console.log('🔍 [DEBUG] session.flow:', session.flow);
          
          if (photos.length === 0) {
            await bot.sendMessage(chatId, '❌ Объявление не может быть создано без фото!\n\nОтправьте хотя бы одно фото товара, затем нажмите «Готово».', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
            return true;
          }
          
          // Save listing
          const listings = await readListings();
          
          // Проверяем на дубликаты по содержимому
          const newListingData = {
            userId: msg.from.id,
            username: msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || '') ,
            type: 'sell', // Тип объявления - продажа
            ...session.temp
          };
          
          console.log('🔍 [DEBUG] Создание объявления - session.temp:', session.temp);
          console.log('🔍 [DEBUG] Создание объявления - newListingData.gender:', newListingData.gender);
          
          // Создаем ключ для проверки дубликатов (только от того же пользователя)
          const contentKey = `${newListingData.userId}_${newListingData.title}_${newListingData.style}_${newListingData.price}_${newListingData.description}_${(newListingData.photos && newListingData.photos[0]) || ''}`;
          
          // Проверяем, есть ли уже такое объявление от того же пользователя
          const isDuplicate = listings.some(existingListing => {
            // Проверяем только объявления от того же пользователя
            if (String(existingListing.userId) !== String(newListingData.userId)) return false;
            const existingKey = `${existingListing.userId}_${existingListing.title}_${existingListing.style}_${existingListing.price}_${existingListing.description}_${(existingListing.photos && existingListing.photos[0]) || ''}`;
            return existingKey === contentKey;
          });
          
          if (isDuplicate) {
            await bot.sendMessage(chatId, '❌ Такое объявление уже существует! Пожалуйста, создайте объявление с другим содержимым.', mainMenuKeyboard());
            users[uid].session = null;
            await writeUsers(users);
            return true;
          }
          
          const listing = {
            id: String(Date.now()),
            ...newListingData,
            createdAt: new Date().toISOString()
          };
          listings.unshift(listing);
          await writeListings(listings);
          users[uid].session = null;
          await bot.sendMessage(chatId, 'Объявление создано ✅', mainMenuKeyboard());
        } else {
          await bot.sendMessage(chatId, 'Отправляйте фото. Когда закончите — нажмите «Готово».', { reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } });
        }
        break;
      default:
        break;
    }
    users[uid].session = session;
    return true;
  }

  if (session.flow === 'seek') {
    switch (session.step) {
      case 'gender':
        // Ожидаем на этом шаге только callback-кнопки, игнорируем текст
        await bot.sendMessage(chatId, 'Выберите пол:', genderKeyboard());
        return true;
      case 'title':
        session.temp = { ...(session.temp||{}), title: text };
        session.step = 'style';
        await bot.sendMessage(chatId, 'Выберите стиль:', stylesKeyboard());
        break;
      case 'price':
        {
          const normalized = String(text).replace(/\s+/g, '').replace(',', '.');
          const valid = /^\d+(?:[\.,]?\d{0,2})?$/.test(text);
          const validNormalized = /^\d+(?:\.\d{0,2})?$/.test(normalized);
          if (!valid && !validNormalized) {
            await bot.sendMessage(chatId, '❌ Введите цену только числом!\n\nПримеры: 1500, 1999.99, 2500');
            return true;
          }
          session.temp.price = validNormalized ? normalized : text;
          session.step = 'description';
          await bot.sendMessage(chatId, '📝 Короткое описание:');
        }
        break;
      case 'description':
        session.temp.description = text;
        session.step = 'photos';
        await bot.sendMessage(chatId, '📸 Отправьте 1-5 фото товара (обязательно минимум 1 фото). Когда закончите — нажмите «Готово».', { reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } });
        break;
      case 'photos':
        if (/^(готово|готов|done|завершить)$/i.test(text) || /^✅ Готово$/i.test(text)) {
          // Проверяем, что загружено хотя бы одно фото
          if (!session.temp.photos || session.temp.photos.length === 0) {
            await bot.sendMessage(chatId, '❌ Нужно отправить хотя бы одно фото!');
            return true;
          }
          
          // Save listing
          const listings = await readListings();
          
          // Проверяем на дубликаты по содержимому
          const newListingData = {
            userId: msg.from.id,
            username: msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || '') ,
            type: 'seek', // Тип объявления - поиск
            ...session.temp
          };
          
          console.log('🔍 [DEBUG] Создание объявления о поиске - session.temp:', session.temp);
          console.log('🔍 [DEBUG] Создание объявления о поиске - newListingData.gender:', newListingData.gender);
          
          // Создаем ключ для проверки дубликатов (только от того же пользователя)
          const contentKey = `${newListingData.userId}_${newListingData.title}_${newListingData.style}_${newListingData.price}_${newListingData.description}_${(newListingData.photos && newListingData.photos[0]) || ''}`;
          
          // Проверяем, есть ли уже такое объявление от того же пользователя
          const isDuplicate = listings.some(existingListing => {
            // Проверяем только объявления от того же пользователя
            if (String(existingListing.userId) !== String(newListingData.userId)) return false;
            const existingKey = `${existingListing.userId}_${existingListing.title}_${existingListing.style}_${existingListing.price}_${existingListing.description}_${(existingListing.photos && existingListing.photos[0]) || ''}`;
            return existingKey === contentKey;
          });
          
          if (isDuplicate) {
            await bot.sendMessage(chatId, '❌ Такое объявление о поиске уже существует! Пожалуйста, создайте объявление с другим содержимым.', mainMenuKeyboard());
            users[uid].session = null;
            await writeUsers(users);
            return true;
          }
          
          const listing = {
            id: String(Date.now()),
            ...newListingData,
            createdAt: new Date().toISOString()
          };
          listings.unshift(listing);
          await writeListings(listings);
          users[uid].session = null;
          await bot.sendMessage(chatId, 'Объявление о поиске создано ✅', mainMenuKeyboard());
        } else {
          await bot.sendMessage(chatId, 'Отправляйте фото. Когда закончите — нажмите «Готово».', { reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } });
        }
        break;
      default:
        break;
    }
    users[uid].session = session;
    return true;
  }

  if (session.flow === 'parse') {
    if (session.step === 'text') {
      // Парсим текст объявления
      const parsed = parseListingText(text);
      // Сохраняем существующие фотографии, если они есть
      const existingPhotos = session.temp.photos || [];
      console.log('🔍 [DEBUG] В handleSessionMessage parse flow - сохранены существующие фото:', existingPhotos);
      
      // Объединяем существующие фото с новыми данными (НЕ перезаписываем фото!)
      session.temp = { ...session.temp, ...parsed, photos: existingPhotos };
      console.log('🔍 [DEBUG] В handleSessionMessage parse flow - итоговые фото в session.temp:', session.temp.photos);
      
      // Показываем что удалось извлечь
      let response = '📝 **Извлеченные данные:**\n\n';
      
      if (parsed.title) response += `✅ Название: ${parsed.title}\n`;
      if (parsed.price) response += `✅ Цена: ${parsed.price}₽\n`;
      if (parsed.size) response += `✅ Размер: ${parsed.size}\n`;
      if (parsed.gender) response += `✅ Пол: ${parsed.gender === 'male' ? 'мужской' : 'женский'}\n`;
      if (parsed.style) response += `✅ Стиль: ${parsed.style}\n`;
      if (parsed.description) response += `✅ Описание: ${parsed.description}\n`;
      
      response += '\n❓ **Недостающие данные:**\n';
      
      const missing = [];
      if (!parsed.title) missing.push('Название товара');
      if (!parsed.price && parsed.price !== 'SOLD') missing.push('Цена');
      if (!parsed.gender) missing.push('Пол');
      if (!parsed.style) missing.push('Стиль');
      
      if (missing.length === 0) {
        response += '✅ Все данные извлечены! Теперь отправьте фото товара.';
        session.step = 'photos';
        await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
      } else {
        response += missing.map(item => `• ${item}`).join('\n');
        response += '\n\nВыберите недостающие данные:';
        session.step = 'missing_data';
        await bot.sendMessage(chatId, response, { 
          parse_mode: 'Markdown',
          ...missingDataKeyboard(missing)
        });
      }
      users[uid].session = session;
      return true;
    }
    
    if (session.step === 'missing_data') {
      // Обрабатываем недостающие данные через кнопки
      await bot.sendMessage(chatId, 'Пожалуйста, используйте кнопки выше для выбора недостающих данных.');
      return true;
    }

    if (session.step === 'missing_price') {
      const priceMatch = text.match(/(\d+(?:[\.,]\d+)?)/);
      if (priceMatch) {
        session.temp.price = priceMatch[1].replace(',', '.');
        await bot.sendMessage(chatId, `✅ Цена: ${session.temp.price}₽`);
        
        // Проверяем, все ли данные собраны
        const stillMissing = [];
        if (!session.temp.title) stillMissing.push('Название товара');
        if (!session.temp.price && session.temp.price !== 'SOLD') stillMissing.push('Цена');
        if (!session.temp.gender) stillMissing.push('Пол');
        if (!session.temp.style) stillMissing.push('Стиль');
        
        if (stillMissing.length === 0) {
          // Проверяем, есть ли уже сохраненные фотографии
          const existingPhotos = session.temp.photos || [];
          if (existingPhotos.length > 0) {
            await bot.sendMessage(chatId, '✅ Все данные собраны! Фото уже добавлены. Нажмите «Готово» для создания объявления.', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
          } else {
            await bot.sendMessage(chatId, '✅ Все данные собраны! Теперь отправьте фото товара.\n\n📸 **Важно:** Отправьте фото как отдельное сообщение, а не как подпись к тексту!', { 
              reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
            });
          }
          session.step = 'photos';
        } else {
          session.step = 'missing_data';
          await bot.sendMessage(chatId, `❓ Осталось указать: ${stillMissing.join(', ')}`, missingDataKeyboard(stillMissing));
        }
      } else {
        await bot.sendMessage(chatId, '❌ Введите цену только числом!\n\nПримеры: 1500, 1999.99, 2500');
      }
      
      users[uid].session = session;
      return true;
    }

    if (session.step === 'missing_title') {
      session.temp.title = text;
      await bot.sendMessage(chatId, `✅ Название: ${text}`);
      
      // Проверяем, все ли данные собраны
      const stillMissing = [];
      if (!session.temp.title) stillMissing.push('Название товара');
      if (!session.temp.price && session.temp.price !== 'SOLD') stillMissing.push('Цена');
      if (!session.temp.gender) stillMissing.push('Пол');
      if (!session.temp.style) stillMissing.push('Стиль');
      if (session.temp.isOriginal === null) stillMissing.push('Оригинал/реплика');
      
      if (stillMissing.length === 0) {
        // Проверяем, есть ли уже сохраненные фотографии
        const existingPhotos = session.temp.photos || [];
        if (existingPhotos.length > 0) {
          await bot.sendMessage(chatId, '✅ Все данные собраны! Фото уже добавлены. Нажмите «Готово» для создания объявления.', {
            reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
          });
        } else {
          await bot.sendMessage(chatId, '✅ Все данные собраны! Теперь отправьте фото товара.\n\n📸 **Важно:** Отправьте фото как отдельное сообщение, а не как подпись к тексту!', {
            reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
          });
        }
        session.step = 'photos';
      } else {
        session.step = 'missing_data';
        await bot.sendMessage(chatId, `❓ Осталось указать: ${stillMissing.join(', ')}`, missingDataKeyboard(stillMissing));
      }
      
      users[uid].session = session;
      return true;
    }
    
    if (session.step === 'photos') {
      // Обрабатываем фото (используем существующую логику)
      if (/^(готово|готов|done|завершить)$/i.test(text) || /^✅ Готово$/i.test(text)) {
        // Проверяем, что загружено хотя бы одно фото
        const photos = session.temp.photos || [];
        console.log('🔍 [DEBUG] Обработка кнопки Готово в режиме парсинга - фото в сессии:', photos);
        console.log('🔍 [DEBUG] Количество фото в сессии:', photos.length);
        console.log('🔍 [DEBUG] session.temp:', session.temp);
        
        if (photos.length === 0) {
          await bot.sendMessage(chatId, '❌ Объявление не может быть создано без фото!\n\nОтправьте хотя бы одно фото товара, затем нажмите «Готово».', { 
            reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } 
          });
          return true;
        }
        
        // Создаем объявление
        const listings = await readListings();
        
        const newListingData = {
          userId: msg.from.id,
          username: msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || ''),
          type: 'sell',
          ...session.temp
        };
        
        // Проверяем на дубликаты
        const contentKey = `${newListingData.userId}_${newListingData.title}_${newListingData.style}_${newListingData.price}_${newListingData.description}_${(newListingData.photos && newListingData.photos[0]) || ''}`;
        
        const isDuplicate = listings.some(existingListing => {
          if (String(existingListing.userId) !== String(newListingData.userId)) return false;
          const existingKey = `${existingListing.userId}_${existingListing.title}_${existingListing.style}_${existingListing.price}_${existingListing.description}_${(existingListing.photos && existingListing.photos[0]) || ''}`;
          return existingKey === contentKey;
        });
        
        if (isDuplicate) {
          await bot.sendMessage(chatId, '❌ Такое объявление уже существует! Пожалуйста, создайте объявление с другим содержимым.', mainMenuKeyboard());
          users[uid].session = null;
          await writeUsers(users);
          return true;
        }
        
        const listing = {
          id: String(Date.now()),
          ...newListingData,
          createdAt: new Date().toISOString()
        };
        listings.unshift(listing);
        await writeListings(listings);
        users[uid].session = null;
        await bot.sendMessage(chatId, '✅ Объявление создано из готового текста!', mainMenuKeyboard());
      } else {
        await bot.sendMessage(chatId, 'Отправляйте фото. Когда закончите — нажмите «Готово».', { reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } });
      }
      
      users[uid].session = session;
      return true;
    }
    
    users[uid].session = session;
    return true;
  }

  if (session.flow === 'feed_params') {
    // Parse simple filters like: стиль архив
    const filters = Object.assign({}, session.filters || {});
    const lower = text.toLowerCase();
    // Оставляем только возможный ввод стиля вида: стиль архив
    const styleMatch = lower.match(/стиль\s*([\w\-]+)/i);
    if (styleMatch) filters.style = styleMatch[1];
    session.filters = filters;
    session.step = 'run';
    await bot.sendMessage(chatId, 'Фильтры обновлены. Показываю ленту.');
    users[uid].session = session;
    await writeUsers(users);
    await startFeedForUser(bot, msg.from.id, chatId, filters, true);
    return true;
  }


  return false;
}

// Функция для парсинга готового объявления
function parseListingText(text) {
  console.log('🔍 [DEBUG] Парсинг текста:', text);
  
  const result = {
    title: '',
    price: '',
    description: '',
    gender: '',
    style: '',
    size: ''
  };

  // Убираем лишние пробелы и переносы строк
  const cleanText = text.replace(/\s+/g, ' ').trim();
  console.log('🔍 [DEBUG] Оригинальный текст:', text);
  console.log('🔍 [DEBUG] Очищенный текст:', cleanText);
  console.log('🔍 [DEBUG] Содержит SOLD?', cleanText.toLowerCase().includes('sold'));
  console.log('🔍 [DEBUG] Поиск SOLD в тексте:', cleanText.match(/sold/gi));
  
  let priceMatch = null; // Объявляем priceMatch здесь
  // Сначала проверяем на "SOLD" - это приоритетнее чем числа
  if (cleanText.toLowerCase().includes('sold')) {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Найдена цена SOLD');
  } else {
    // Ищем цену (числа с ₽, руб, р или просто числа)
    // Сначала ищем цены с валютой
    priceMatch = cleanText.match(/(\d+(?:[\.,]\d+)?)\s*(?:₽|руб|р|рублей?)/i);
    if (priceMatch) {
      result.price = priceMatch[1].replace(',', '.');
      console.log('🔍 [DEBUG] Найдена цена с валютой:', result.price);
    } else {
      // Если не найдена цена с валютой, ищем просто числа (но не в контексте "9/10")
      priceMatch = cleanText.match(/(?<!\d\/)\b(\d{3,}(?:[\.,]\d+)?)\b(?!\s*\/\d)/);
      if (priceMatch) {
        result.price = priceMatch[1].replace(',', '.');
        console.log('🔍 [DEBUG] Найдена числовая цена без валюты:', result.price);
      }
    }
  }
  
  // Дополнительная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Исправлена цена с SOLDP на SOLD');
  }
  
  // Еще одна проверка - если в тексте есть "SOLD", но цена не установлена
  if (!result.price && cleanText.toLowerCase().includes('sold')) {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Установлена цена SOLD из текста');
  }
  
  // Финальная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Финальная исправка цены с SOLDP на SOLD');
  }
  
  // Дополнительная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Исправлена цена с SOLDP на SOLD');
  }
  
  // Дополнительная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Исправлена цена с SOLDP на SOLD');
  }
  
  // Еще одна проверка - если в тексте есть "SOLD", но цена не установлена
  if (!result.price && cleanText.toLowerCase().includes('sold')) {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Установлена цена SOLD из текста');
  }
  
  // Финальная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Финальная исправка цены с SOLDP на SOLD');
  }
  
  // Дополнительная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Исправлена цена с SOLDP на SOLD');
  }
  
  // Еще одна проверка - если в тексте есть "SOLD", но цена не установлена
  if (!result.price && cleanText.toLowerCase().includes('sold')) {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Установлена цена SOLD из текста');
  }
  
  // Дополнительная проверка - если цена содержит "SOLDP", исправляем на "SOLD"
  if (result.price === 'SOLDP') {
    result.price = 'SOLD';
    console.log('🔍 [DEBUG] Исправлена цена с SOLDP на SOLD');
  }
  
  console.log('🔍 [DEBUG] Итоговая цена:', result.price);

  // Ищем размер (размер: 42, size: L, 42 размер и т.д.)
  const sizeMatch = cleanText.match(/(?:размер|size)[\s:]*([A-Z0-9]+)/i);
  if (sizeMatch) {
    result.size = sizeMatch[1];
  }
  
  // Ищем размер в формате "Размер:М" или "Размер М"
  const sizeMatch2 = cleanText.match(/размер[\s:]*([A-Z0-9]+)/i);
  if (sizeMatch2 && !result.size) {
    result.size = sizeMatch2[1];
  }

  // Ищем пол (мужской/женский, муж/жен, male/female)
  const genderMatch = cleanText.match(/(мужской|женский|муж|жен|male|female)/i);
  if (genderMatch) {
    const gender = genderMatch[1].toLowerCase();
    if (['мужской', 'муж', 'male'].includes(gender)) {
      result.gender = 'male';
    } else if (['женский', 'жен', 'female'].includes(gender)) {
      result.gender = 'female';
    }
  }


  // Ищем стиль (архив, кежуал, стритвир и т.д.)
  const styles = ['архив', 'кежуал', 'casual', 'стритвир', 'streetwear', 'old money', 'другое'];
  for (const style of styles) {
    if (cleanText.toLowerCase().includes(style)) {
      result.style = style;
      break;
    }
  }

  // Пытаемся извлечь название (первая строка или часть до цены)
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  if (lines.length > 0) {
    let title = lines[0];
    
    // Ищем строку, которая выглядит как название товара (не содержит служебную информацию)
    const titleCandidates = lines.filter(line => {
      const lowerLine = line.toLowerCase();
      // Исключаем строки с служебной информацией
      return !lowerLine.includes('размер') && 
             !lowerLine.includes('состояние') && 
             !lowerLine.includes('связь') && 
             !lowerLine.includes('sold') &&
             !line.match(/\d+(?:[\.,]\d+)?\s*(?:₽|руб|р)/) &&
             line.length > 3; // Название должно быть достаточно длинным
    });
    
    if (titleCandidates.length > 0) {
      title = titleCandidates[0];
    } else if (priceMatch && title.includes(priceMatch[1])) {
      title = lines.find(line => !line.match(/\d+(?:[\.,]\d+)?\s*(?:₽|руб|р)/)) || lines[0];
    }
    
    result.title = title;
  }

  // Описание - все остальное, что не является ценой, размером и т.д.
  let description = cleanText;
  
  // Убираем найденные элементы из описания
  if (priceMatch) description = description.replace(priceMatch[0], '').trim();
  if (sizeMatch) description = description.replace(sizeMatch[0], '').trim();
  if (sizeMatch2) description = description.replace(sizeMatch2[0], '').trim();
  if (genderMatch) description = description.replace(genderMatch[0], '').trim();
  if (result.style) description = description.replace(result.style, '').trim();
  if (result.title) description = description.replace(result.title, '').trim();
  
  // Убираем служебную информацию из описания
  description = description.replace(/состояние\s*:\s*\d+\/\d+/gi, '').trim();
  description = description.replace(/связь\s*:\s*@?\w+/gi, '').trim();
  description = description.replace(/sold/gi, '').trim();
  
  // Убираем размеры в любом формате
  description = description.replace(/размер[\s:]*[A-Z0-9]+/gi, '').trim();
  description = description.replace(/размер\s*:\s*[A-Z0-9]+/gi, '').trim();
  description = description.replace(/размер\s*:\s*[A-Z0-9]+/gi, '').trim();
  description = description.replace(/размер\s*:\s*[A-Z0-9]+/gi, '').trim();
  description = description.replace(/размер\s*:\s*[A-Z0-9]+/gi, '').trim();
  
  console.log('🔍 [DEBUG] Описание после удаления размера:', description);
  
  result.description = description.replace(/\s+/g, ' ').trim();

  console.log('🔍 [DEBUG] Результат парсинга:', result);
  return result;
}

async function beginParseFlow(bot, from, chatId) {
  const users = await readUsers();
  const uid = String(from.id);
  users[uid] = users[uid] || { profile: {}, platinum: false };
  
  // Сохраняем данные пользователя при первом обращении
  if (!users[uid].profile.username) {
    users[uid].profile.username = from.username || 'Неизвестно';
    users[uid].profile.firstName = from.first_name || 'Неизвестно';
  }
  
    // Проверяем, есть ли сохраненный текст из пересланного сообщения
    const forwardedText = users[uid].forwardedText;
    const forwardedPhotos = users[uid].forwardedPhotos || [];
    
    console.log('🔍 [DEBUG] beginParseFlow - forwardedText:', forwardedText);
    console.log('🔍 [DEBUG] beginParseFlow - forwardedPhotos:', forwardedPhotos);
    console.log('🔍 [DEBUG] beginParseFlow - количество forwardedPhotos:', forwardedPhotos.length);
  
  users[uid].session = { flow: 'parse', step: 'text', temp: {} };
  await writeUsers(users);
  
  if (forwardedText) {
    // Если есть сохраненный текст, сразу парсим его
    console.log('🔍 [DEBUG] Используем сохраненный текст:', forwardedText);
    console.log('🔍 [DEBUG] Используем сохраненные фото:', forwardedPhotos);
    console.log('🔍 [DEBUG] Количество сохраненных фото:', forwardedPhotos.length);
    
    const parsed = parseListingText(forwardedText);
    users[uid].session.temp = { ...parsed, photos: forwardedPhotos };
    console.log('🔍 [DEBUG] В beginParseFlow - установлены фото в session.temp:', users[uid].session.temp.photos);
    console.log('🔍 [DEBUG] В beginParseFlow - forwardedPhotos:', forwardedPhotos);
    console.log('🔍 [DEBUG] В beginParseFlow - количество forwardedPhotos:', forwardedPhotos.length);
    console.log('🔍 [DEBUG] В beginParseFlow - parsed данные:', parsed);
    console.log('🔍 [DEBUG] В beginParseFlow - session.temp после установки:', users[uid].session.temp);
    
    console.log('🔍 [DEBUG] Установлены фото в session.temp:', users[uid].session.temp.photos);
    console.log('🔍 [DEBUG] Проверка фото в сессии:', users[uid].session.temp.photos);
    console.log('🔍 [DEBUG] Количество фото в сессии:', users[uid].session.temp.photos?.length || 0);
    
    // Сохраняем сессию перед очисткой forwardedPhotos
    await writeUsers(users);
    
    // Показываем что удалось извлечь
    let response = '📝 **Извлеченные данные:**\n\n';
    
    if (parsed.title) response += `✅ Название: ${parsed.title}\n`;
    if (parsed.price) response += `✅ Цена: ${parsed.price}${parsed.price === 'SOLD' ? '' : '₽'}\n`;
    if (parsed.size) response += `✅ Размер: ${parsed.size}\n`;
    if (parsed.gender) response += `✅ Пол: ${parsed.gender === 'male' ? 'мужской' : 'женский'}\n`;
    if (parsed.style) response += `✅ Стиль: ${parsed.style}\n`;
    if (parsed.isOriginal !== null) response += `✅ Тип: ${parsed.isOriginal ? 'Оригинал' : 'Реплика'}\n`;
    if (parsed.description) response += `✅ Описание: ${parsed.description}\n`;
    
    response += '\n❓ **Недостающие данные:**\n';
    
    const missing = [];
    if (!parsed.title) missing.push('Название товара');
    if (!parsed.price && parsed.price !== 'SOLD') missing.push('Цена');
    if (!parsed.gender) missing.push('Пол');
    if (!parsed.style) missing.push('Стиль');
    
    if (missing.length === 0) {
      if (forwardedPhotos.length > 0) {
        response += '✅ Все данные извлечены! Фото уже добавлены. Нажмите «Готово» для создания объявления.';
        users[uid].session.step = 'photos';
      } else {
        response += '✅ Все данные извлечены! Теперь отправьте фото товара.';
        users[uid].session.step = 'photos';
      }
    } else {
      if (forwardedPhotos.length > 0) {
        response += `\n📸 **Фото:** ${forwardedPhotos.length} шт.`;
      }
      response += missing.map(item => `• ${item}`).join('\n');
      response += '\n\nВыберите недостающие данные:';
      users[uid].session.step = 'missing_data';
    }
    
    console.log('🔍 [DEBUG] Финальный шаг сессии:', users[uid].session.step);
    console.log('🔍 [DEBUG] Фото в сессии:', users[uid].session.temp.photos);
    console.log('🔍 [DEBUG] Количество фото в сессии:', users[uid].session.temp.photos?.length || 0);
    console.log('🔍 [DEBUG] Проверка сохранения фото в сессии после парсинга:', users[uid].session.temp.photos);
    
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    
    // Очищаем сохраненный текст и фото
    delete users[uid].forwardedText;
    delete users[uid].forwardedPhotos;
    await writeUsers(users);
  } else {
    await bot.sendMessage(chatId, 
      '📝 **Отправьте готовое объявление**\n\n' +
      'Просто скопируйте и отправьте текст объявления, а я автоматически извлеку из него:\n' +
      '• Название товара\n' +
      '• Цену\n' +
      '• Размер (если есть)\n' +
      '• Пол (мужской/женский)\n' +
      '• Стиль\n' +
      '• Описание\n\n' +
      'Если чего-то не хватает - я спрошу отдельно!',
      { parse_mode: 'Markdown' }
    );
  }
}

async function beginSellFlow(bot, from, chatId) {
  const users = await readUsers();
  const uid = String(from.id);
  users[uid] = users[uid] || { profile: {}, platinum: false };
  
  // Сохраняем данные пользователя при первом обращении
  if (!users[uid].profile.username) {
    users[uid].profile.username = from.username || 'Неизвестно';
    users[uid].profile.firstName = from.first_name || 'Неизвестно';
  }
  
  users[uid].session = { flow: 'sell', step: 'gender', temp: {} };
  await writeUsers(users);
  await bot.sendMessage(chatId, 'Создаём объявление. Выберите пол:', genderKeyboard());
}


async function startFeedForUser(bot, userId, chatId, filters, keepPosition = false) {
  const users = await readUsers();
  const uid = String(userId);
  const listings = await readListings();
  const filtered = listings.filter((l) => {
    // Показываем только одобренные объявления (кроме своих)
    // Для старых объявлений без поля approved считаем их одобренными
    if (!filters || !filters.ownerOnly) {
      if (l.approved === false) return false; // Только явно отклоненные скрываем
    }
    
    if (filters && filters.ownerOnly) {
      if (String(l.userId) !== uid) return false;
    }
    // По умолчанию исключаем свои объявления из любой выдачи
    if (!filters || !filters.ownerOnly) {
      if (String(l.userId) === uid) return false;
    }
    // Если есть фильтры по стилю ИЛИ описанию ИЛИ полу
    if (filters && (filters.style || filters.q || filters.gender)) {
      let matchesStyle = false;
      let matchesDescription = false;
      let matchesGender = false;
      
      // Проверяем стиль (с учетом опечаток)
      if (filters.style) {
        const s = String(filters.style).toLowerCase().trim();
        const listingStyle = (l.style || '').toLowerCase().trim();
        
        // Если выбрали конкретный стиль - показываем объявления с этим стилем И со стилем "другое"
        if (s !== 'другое') {
          matchesStyle = listingStyle === s || 
                        listingStyle.includes(s) || 
                        s.includes(listingStyle) ||
                        isSimilar(s, listingStyle) ||
                        listingStyle === 'другое';
        } else {
          // Если выбрали "другое" - показываем ВСЕ объявления (не фильтруем по стилю)
          matchesStyle = true;
        }
      }
      
      // Проверяем описание/название (с учетом опечаток)
      if (filters.q) {
        const q = String(filters.q).toLowerCase().trim();
        const title = String(l.title || '').toLowerCase();
        const desc = String(l.description || '').toLowerCase();
        matchesDescription = title.includes(q) || 
                           desc.includes(q) ||
                           isSimilar(q, title) ||
                           isSimilar(q, desc);
      }
      
      // Проверяем пол
      if (filters.gender) {
        const filterGender = String(filters.gender).toLowerCase().trim();
        const listingGender = String(l.gender || '').toLowerCase().trim();
        matchesGender = filterGender === listingGender;
        console.log('🔍 [DEBUG] Фильтр по полу - ищем:', filterGender, 'у объявления:', listingGender, 'совпадение:', matchesGender);
      }
      
      // Проверяем все активные фильтры
      if (filters.style && !matchesStyle) return false;
      if (filters.q && !matchesDescription) return false;
      if (filters.gender && !matchesGender) return false;
    }
    if (filters && typeof filters.maxPrice !== 'undefined') {
      const pStr = String(l.price || '').replace(/\s+/g, '').replace(',', '.');
      const p = parseFloat(pStr);
      const maxP = parseFloat(String(filters.maxPrice));
      if (Number.isFinite(maxP)) {
        if (!Number.isFinite(p) || p > maxP) return false;
      }
    }
    return true;
  });

  users[uid] = users[uid] || { profile: {} };
  const current = users[uid].feed || {};
  
  // Сортируем объявления с учетом 30% приоритета для platinum
  const sortedListings = filtered.sort((a, b) => {
    const aAuthor = users[String(a.userId)];
    const bAuthor = users[String(b.userId)];
    const aPlatinum = aAuthor && aAuthor.platinum;
    const bPlatinum = bAuthor && bAuthor.platinum;
    
    // Если оба platinum или оба обычные - сортируем по дате
    if (aPlatinum === bPlatinum) {
      return (b.timestamp || 0) - (a.timestamp || 0);
    }
    
    // Применяем 30% приоритет для platinum объявлений
    // Генерируем случайное число от 0 до 1
    const random = Math.random();
    
    if (aPlatinum && !bPlatinum) {
      // Если a - platinum, а b - обычное, то a имеет 30% шанс быть выше
      return random < 0.3 ? -1 : 1;
    } else if (!aPlatinum && bPlatinum) {
      // Если a - обычное, а b - platinum, то b имеет 30% шанс быть выше
      return random < 0.3 ? 1 : -1;
    }
    
    // Fallback - сортируем по дате
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  
  // Уникальные ID (на случай дублей в источнике)
  const uniqueList = Array.from(new Set(sortedListings.map(l => l.id)));

  users[uid].feed = {
    list: uniqueList,
    index: keepPosition ? (current.index || 0) : 0,
    filters: filters || {},
    seen: keepPosition ? (current.seen || []) : [],
    seenByContent: keepPosition ? (current.seenByContent || []) : []
  };
  
  // Убеждаемся, что seenByContent инициализирован для всех пользователей
  if (!Array.isArray(users[uid].feed.seenByContent)) {
    users[uid].feed.seenByContent = [];
  }
  users[uid].session = null; // exit any text capture
  await writeUsers(users);

  if (filtered.length === 0) {
    await bot.sendMessage(chatId, 'Ничего не найдено по вашим параметрам.', {
      reply_markup: { 
        keyboard: [[{ text: '💤' }]], 
        resize_keyboard: true,
        remove_keyboard: false
      }
    });
    return;
  }
  const first = listings.find(l => l.id === users[uid].feed.list[users[uid].feed.index]);
  const ownerOnly = !!(users[uid].feed && users[uid].feed.filters && users[uid].feed.filters.ownerOnly);
  await sendListingCard(bot, chatId, first, ownerOnly);
  await feedControls.applyFromState(bot, chatId, users, uid);
  // Помечаем показанное объявление как просмотренное
  const feedAfterSend = users[uid].feed || {};
  feedAfterSend.seen = Array.isArray(feedAfterSend.seen) ? feedAfterSend.seen : [];
  if (first && !feedAfterSend.seen.includes(first.id)) feedAfterSend.seen.push(first.id);
  
  // Помечаем по содержимому (только для одного пользователя)
  if (first) {
    const contentKey = `${first.userId}_${first.title}_${first.style}_${first.price}_${first.description}_${(first.photos && first.photos[0]) || ''}`;
    feedAfterSend.seenByContent = Array.isArray(feedAfterSend.seenByContent) ? feedAfterSend.seenByContent : [];
    if (!feedAfterSend.seenByContent.includes(contentKey)) {
      feedAfterSend.seenByContent.push(contentKey);
    }
  }
  
  users[uid].feed = feedAfterSend;
  await writeUsers(users);
}

// Глобальная переменная для отслеживания активных вызовов showNextInFeed
const activeShowNextCalls = new Set();

async function showNextInFeed(bot, userId, chatId) {
  const uid = String(userId);
  
  // Защита от повторных вызовов
  if (activeShowNextCalls.has(uid)) {
    console.log('🔍 [DEBUG] Пропускаем повторный вызов showNextInFeed для пользователя', uid);
    return;
  }
  
  activeShowNextCalls.add(uid);
  
  try {
    const users = await readUsers();
    const listings = await readListings();
    const feed = users[uid] && users[uid].feed ? users[uid].feed : null;
    if (!feed || !Array.isArray(feed.list) || feed.list.length === 0) {
      await bot.sendMessage(chatId, 'Лента пуста. Вернитесь в меню и начните заново.', mainMenuKeyboard());
      return;
    }
  const seen = Array.isArray(feed.seen) ? new Set(feed.seen) : new Set();
  console.log('🔍 [DEBUG] showNextInFeed - текущий seen:', Array.from(seen));
  console.log('🔍 [DEBUG] showNextInFeed - текущий индекс:', feed.index);
  console.log('🔍 [DEBUG] showNextInFeed - всего объявлений в ленте:', feed.list.length);
  
  // Функция для создания уникального ключа объявления на основе содержимого (только для одного пользователя)
  const getListingContentKey = (listing) => {
    if (!listing) return null;
    // Включаем userId чтобы не скрывать объявления от разных пользователей
    return `${listing.userId}_${listing.title}_${listing.style}_${listing.price}_${listing.description}_${(listing.photos && listing.photos[0]) || ''}`;
  };
  
  // Создаем Set для отслеживания просмотренных объявлений по содержимому
  const seenByContent = new Set();
  if (Array.isArray(feed.seenByContent)) {
    feed.seenByContent.forEach(key => seenByContent.add(key));
  } else {
    // Инициализируем seenByContent если его нет
    feed.seenByContent = [];
  }
  // Рефильтруем список на лету по актуальным данным
  console.log('🔍 [DEBUG] Рефильтрация - всего объявлений в базе:', listings.length);
  console.log('🔍 [DEBUG] Рефильтрация - фильтры:', feed.filters);
  console.log('🔍 [DEBUG] Рефильтрация - текущий пользователь (uid):', uid);
  
  // Принудительно рефильтруем все объявления
  const refiltered = listings.filter((l) => {
    console.log('🔍 [DEBUG] Проверяем объявление:', l.id, 'userId:', l.userId, 'style:', l.style);
    
    if (feed.filters && feed.filters.ownerOnly) {
      if (String(l.userId) !== uid) {
        console.log('🔍 [DEBUG] Исключено - ownerOnly, не наш пользователь');
        return false;
      }
    } else {
      if (String(l.userId) === uid) {
        console.log('🔍 [DEBUG] Исключено - свой пользователь (userId:', l.userId, '=== uid:', uid, ')');
        return false;
      } else {
        console.log('🔍 [DEBUG] НЕ свой пользователь (userId:', l.userId, '!== uid:', uid, ')');
      }
    }
    if (feed.filters && feed.filters.style) {
      const s = String(feed.filters.style).toLowerCase().trim();
      const listingStyle = (l.style || '').toLowerCase().trim();
      
      console.log('🔍 [DEBUG] Фильтр по стилю - ищем:', s, 'у объявления:', listingStyle);
      
      // Если выбрали конкретный стиль - показываем только объявления с этим стилем
      if (s === 'другое') {
        // Если выбрали "другое" - показываем ВСЕ объявления (не фильтруем по стилю)
        console.log('🔍 [DEBUG] Фильтр "Другое" - показываем все объявления');
      } else {
        // Если выбрали конкретный стиль (например, "архив") - показываем объявления с этим стилем И "другое"
        if (listingStyle !== s && listingStyle !== 'другое') {
          console.log('🔍 [DEBUG] Исключено - не подходит по стилю (ищем:', s, 'у объявления:', listingStyle, ')');
          return false;
        }
        console.log('🔍 [DEBUG] Фильтр', s, '- показываем объявления со стилем', s, 'и "другое"');
      }
    }
    
    // Фильтрация по полу
    if (feed.filters && feed.filters.gender) {
      const filterGender = String(feed.filters.gender).toLowerCase().trim();
      const listingGender = String(l.gender || '').toLowerCase().trim();
      console.log('🔍 [DEBUG] Фильтр по полу - ищем:', filterGender, 'у объявления:', listingGender, 'совпадение:', filterGender === listingGender);
      if (filterGender !== listingGender) {
        console.log('🔍 [DEBUG] Исключено - не подходит по полу');
        return false;
      }
    }
    
    if (feed.filters && feed.filters.q) {
      const q = String(feed.filters.q).toLowerCase();
      const title = String(l.title || '').toLowerCase();
      const desc = String(l.description || '').toLowerCase();
      if (!title.includes(q) && !desc.includes(q)) return false;
    }
    if (feed.filters && typeof feed.filters.maxPrice !== 'undefined') {
      const pStr = String(l.price || '').replace(/\s+/g, '').replace(',', '.');
      const p = parseFloat(pStr);
      const maxP = parseFloat(String(feed.filters.maxPrice));
      if (Number.isFinite(maxP)) {
        if (!Number.isFinite(p) || p > maxP) return false;
      }
    }
    console.log('🔍 [DEBUG] Объявление прошло все фильтры:', l.id);
    return true;
  });
  console.log('🔍 [DEBUG] После рефильтрации осталось объявлений:', refiltered.length);
  feed.list = Array.from(new Set(refiltered.map(l => l.id)));
  console.log('🔍 [DEBUG] Уникальных ID в ленте:', feed.list.length);
  
  // Сбрасываем индекс если лента изменилась
  if (feed.index >= feed.list.length) {
    feed.index = 0;
    console.log('🔍 [DEBUG] Сбросили индекс до 0, так как лента изменилась');
  }

  let guard = 0;
  let listing;
  let startIndex = feed.index;
  let foundNew = false;
  
  do {
    if (feed.list.length === 0) break;
    feed.index = (feed.index + 1) % feed.list.length;
    listing = listings.find(l => l.id === feed.list[feed.index]);
    guard++;
    console.log('🔍 [DEBUG] Проверяем listing ID:', listing ? listing.id : 'null', 'seen?', listing ? seen.has(listing.id) : 'N/A');
    if (!listing) continue;
    if (feed.filters && feed.filters.ownerOnly && String(listing.userId) !== String(userId)) continue;
    
    // Сначала проверяем дубликаты по содержимому от одного пользователя
    const contentKey = getListingContentKey(listing);
    if (contentKey && seenByContent.has(contentKey)) {
      console.log('🔍 [DEBUG] Пропускаем дубликат по содержимому:', listing.id, 'contentKey:', contentKey);
      continue;
    }
    
    // Затем проверяем по ID
    if (seen.has(listing.id)) {
      console.log('🔍 [DEBUG] Пропускаем, уже в seen:', listing.id);
      continue;
    }
    console.log('🔍 [DEBUG] Нашли новое объявление:', listing.id);
    foundNew = true;
    break;
  } while (guard <= feed.list.length + 1);
  
  // Если не нашли новое объявление, проверяем, не прошли ли мы полный круг
  if (!foundNew) {
    console.log('🔍 [DEBUG] Не нашли новое объявление, лента закончилась');
    listing = null;
  }

  if (!listing) {
    // Если все объявления просмотрены, просто сообщаем об этом
    console.log('🔍 [DEBUG] Все объявления просмотрены, лента закончилась');
    await bot.sendMessage(chatId, '📭 Лента закончилась! Все объявления просмотрены.', feedReplyKeyboard(false));
    return;
  }

  // Если в ленте только одно объявление и оно уже просмотрено, сообщаем об окончании
  if (feed.list.length === 1 && seen.has(feed.list[0])) {
    console.log('🔍 [DEBUG] В ленте только одно объявление и оно уже просмотрено, лента закончилась');
    await bot.sendMessage(chatId, '📭 Лента закончилась! Все объявления просмотрены.', feedReplyKeyboard(false));
    return;
  }

  const ownerOnly = !!(feed.filters && feed.filters.ownerOnly);
  await sendListingCard(bot, chatId, listing, ownerOnly);
  
  // Перечитываем users, чтобы получить актуальное состояние seen
  const freshUsers = await readUsers();
  const freshFeed = freshUsers[uid] && freshUsers[uid].feed ? freshUsers[uid].feed : feed;
  
  await feedControls.applyFromState(bot, chatId, freshUsers, uid);
  // Пометить как просмотренное
  freshFeed.seen = Array.isArray(freshFeed.seen) ? freshFeed.seen : [];
  if (!freshFeed.seen.includes(listing.id)) {
    freshFeed.seen.push(listing.id);
    console.log('🔍 [DEBUG] Добавили в seen после показа:', listing.id);
  }
  
  // Пометить по содержимому (только для одного пользователя)
  const contentKey = getListingContentKey(listing);
  if (contentKey) {
    freshFeed.seenByContent = Array.isArray(freshFeed.seenByContent) ? freshFeed.seenByContent : [];
    if (!freshFeed.seenByContent.includes(contentKey)) {
      freshFeed.seenByContent.push(contentKey);
      console.log('🔍 [DEBUG] Добавили в seenByContent после показа:', contentKey);
    }
  }
  
  // Обновляем индекс на найденное объявление
  freshFeed.index = feed.index;
  freshUsers[uid].feed = freshFeed;
  await writeUsers(freshUsers);
  console.log('🔍 [DEBUG] Сохранили seen после показа:', freshFeed.seen);
  console.log('🔍 [DEBUG] Сохранили seenByContent после показа:', freshFeed.seenByContent);
  console.log('🔍 [DEBUG] Текущий индекс после показа:', freshFeed.index);
  
  } finally {
    // Убираем пользователя из активных вызовов
    activeShowNextCalls.delete(uid);
  }
}

async function askFeedParams(bot, userId, chatId) {
  const users = await readUsers();
  const uid = String(userId);
  users[uid] = users[uid] || { profile: {} };
  
  // Сохраняем данные пользователя при первом обращении
  if (!users[uid].profile.username) {
    // Получаем данные пользователя из сообщения, если доступны
    const userInfo = await bot.getChat(userId).catch(() => null);
    if (userInfo) {
      users[uid].profile.username = userInfo.username || 'Неизвестно';
      users[uid].profile.firstName = userInfo.first_name || 'Неизвестно';
    }
  }
  
  users[uid].session = { flow: 'feed_params', step: 'ask', filters: (users[uid].feed && users[uid].feed.filters) || {} };
  await writeUsers(users);
  await bot.sendMessage(chatId, 'Добавьте параметры (пример: "стиль архив").');
}

async function handleListingYes(bot, from, chatId, listingId) {
  const listings = await readListings();
  const listing = listings.find(l => String(l.id) === String(listingId));
  if (!listing) return bot.sendMessage(chatId, 'Объявление не найдено.');

  const buyer = from.username ? `@${from.username}` : (from.first_name || String(from.id));
  const seller = listing.username || String(listing.userId);

  // Не показываем контакт, если это своё объявление
  if (String(listing.userId) === String(from.id)) {
    await bot.sendMessage(chatId, 'Это ваше объявление.', mainMenuKeyboard());
    return;
  }

  await bot.sendMessage(chatId, `Супер! Свяжитесь с продавцом: ${seller}`);
  // Notify seller (if bot can DM them)
  try {
    await bot.sendMessage(listing.userId, `Покупатель ${buyer} заинтересован в вашем товаре: "${listing.title}".`);
  } catch (_) {}
}


// Handle style selection during sell flow
// We reuse callback handler above for style: set listing style when in sell flow
// Extend callback handling by intercepting style selection while session.flow === 'sell'

// Установить клавиатуру сна (с принудительным снятием старой)
async function setSleepKeyboard(bot, chatId) {
  try { await bot.sendMessage(chatId, '\u200B', { reply_markup: { remove_keyboard: true } }); } catch (_) {}
  try { await new Promise((r) => setTimeout(r, 80)); } catch(_) {}
  try { await bot.sendMessage(chatId, '\u200B', feedReplyKeyboard(true)); } catch (_) {}
}

// ===== Мои объявления: меню, просмотр, удаление =====
async function showMyListingsMenu(bot, userId, chatId, page = 0) {
  const listings = await readListings();
  const mine = listings.filter(l => String(l.userId) === String(userId));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(mine.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  const slice = mine.slice(start, start + pageSize);

  const rows = slice.map(l => [{ text: l.title || '(без названия)', callback_data: `my_view:${l.id}` }]);
  const nav = [];
  if (safePage > 0) nav.push({ text: '⬅️ Назад', callback_data: `my_list:${safePage - 1}` });
  if (safePage < totalPages - 1) nav.push({ text: 'Вперёд ➡️', callback_data: `my_list:${safePage + 1}` });
  if (nav.length) rows.push(nav);

  await bot.sendMessage(chatId, `Ваши объявления (${mine.length})`, { reply_markup: { inline_keyboard: rows } });
  // Поставим клавиатуру с кнопкой сна ПОСЛЕ контента, чтобы она стала последней
  await setSleepKeyboard(bot, chatId);
}

async function showMyListing(bot, userId, chatId, listingId) {
  const listings = await readListings();
  const l = listings.find(x => String(x.id) === String(listingId) && String(x.userId) === String(userId));
  if (!l) { await bot.sendMessage(chatId, 'Объявление не найдено.'); return; }
  const caption = formatListingCaption(l);
  const kb = { 
    reply_markup: { 
      inline_keyboard: [
        [{ text: '✏️ Изменить объявление', callback_data: `my_edit:${l.id}` }],
        [{ text: '🗑️ Удалить объявление', callback_data: `my_del:${l.id}` }],
        [{ text: '⬅️ Назад к списку', callback_data: 'my_list:0' }]
      ] 
    } 
  };
  if (Array.isArray(l.photos) && l.photos.length > 0) {
    try { await bot.sendPhoto(chatId, l.photos[0], { caption, ...kb }); return; } catch (_) {}
  }
  await bot.sendMessage(chatId, caption, kb);
  await setSleepKeyboard(bot, chatId);
}

async function deleteMyListing(bot, userId, chatId, listingId) {
  const listings = await readListings();
  const idx = listings.findIndex(x => String(x.id) === String(listingId) && String(x.userId) === String(userId));
  if (idx === -1) { await bot.sendMessage(chatId, 'Объявление не найдено или уже удалено.'); return; }
  listings.splice(idx, 1);
  await writeListings(listings);
  await bot.sendMessage(chatId, 'Объявление удалено ✅');
  await showMyListingsMenu(bot, userId, chatId, 0);
}

async function editMyListing(bot, userId, chatId, listingId) {
  const listings = await readListings();
  const listing = listings.find(x => String(x.id) === String(listingId) && String(x.userId) === String(userId));
  if (!listing) { 
    await bot.sendMessage(chatId, 'Объявление не найдено.'); 
    return; 
  }

  // Показываем меню редактирования
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Изменить название', callback_data: `edit_title:${listingId}` }],
        [{ text: '💰 Изменить цену', callback_data: `edit_price:${listingId}` }],
        [{ text: '📄 Изменить описание', callback_data: `edit_description:${listingId}` }],
        [{ text: '📸 Изменить фото', callback_data: `edit_photos:${listingId}` }],
        [{ text: '👤 Изменить пол', callback_data: `edit_gender:${listingId}` }],
        [{ text: '🎨 Изменить стиль', callback_data: `edit_style:${listingId}` }],
        [{ text: '⬅️ Назад к объявлению', callback_data: `my_view:${listingId}` }]
      ]
    }
  };

  await bot.sendMessage(chatId, 
    '✏️ **Редактирование объявления**\n\n' +
    'Выберите, что хотите изменить:',
    { parse_mode: 'Markdown', ...kb }
  );
}

async function startEditField(bot, userId, chatId, listingId, field) {
  const listings = await readListings();
  const listing = listings.find(x => String(x.id) === String(listingId) && String(x.userId) === String(userId));
  if (!listing) { 
    await bot.sendMessage(chatId, 'Объявление не найдено.'); 
    return; 
  }

  // Сохраняем информацию о редактировании в сессии пользователя
  const users = await readUsers();
  const uid = String(userId);
  users[uid] = users[uid] || { profile: {}, platinum: false };
  users[uid].editingListing = { id: listingId, field: field };
  await writeUsers(users);

  let message = '';
  let keyboard = null;

  switch (field) {
    case 'title':
      message = '📝 **Изменение названия**\n\nВведите новое название товара:';
      break;
    case 'price':
      message = '💰 **Изменение цены**\n\nВведите новую цену (только число, например: 1500):';
      break;
    case 'description':
      message = '📄 **Изменение описания**\n\nВведите новое описание товара:';
      break;
    case 'photos':
      message = '📸 **Изменение фото**\n\nОтправьте новые фото товара (1-5 штук). Когда закончите — нажмите «Готово».';
      keyboard = { reply_markup: { keyboard: [[{ text: '✅ Готово' }]], resize_keyboard: true } };
      break;
    case 'gender':
      message = '👤 **Изменение пола**\n\nВыберите пол:';
      keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👨 Мужской', callback_data: `edit_gender_set:${listingId}:male` }],
            [{ text: '👩 Женский', callback_data: `edit_gender_set:${listingId}:female` }]
          ]
        }
      };
      break;
    case 'style':
      message = '🎨 **Изменение стиля**\n\nВыберите стиль:';
      keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Архив', callback_data: `edit_style_set:${listingId}:архив` }],
            [{ text: 'Кежуал', callback_data: `edit_style_set:${listingId}:кежуал` }],
            [{ text: 'Old money', callback_data: `edit_style_set:${listingId}:old money` }],
            [{ text: 'Стритвир', callback_data: `edit_style_set:${listingId}:стритвир` }],
            [{ text: 'Другое', callback_data: `edit_style_set:${listingId}:другое` }]
          ]
        }
      };
      break;
  }

  await bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown', 
    ...(keyboard || {}) 
  });
}

async function updateListingField(bot, userId, chatId, listingId, field, value) {
  const listings = await readListings();
  const listing = listings.find(x => String(x.id) === String(listingId) && String(x.userId) === String(userId));
  if (!listing) { 
    await bot.sendMessage(chatId, 'Объявление не найдено.'); 
    return; 
  }

  // Обновляем поле
  listing[field] = value;
  await writeListings(listings);

  // Очищаем сессию редактирования
  const users = await readUsers();
  const uid = String(userId);
  if (users[uid] && users[uid].editingListing) {
    delete users[uid].editingListing;
    await writeUsers(users);
  }

  await bot.sendMessage(chatId, `✅ Поле "${field}" успешно обновлено!`);
  await showMyListing(bot, userId, chatId, listingId);
}


