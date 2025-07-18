require('dotenv').config();
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN in environment.');

const bot = new Telegraf(BOT_TOKEN);

let users = {};
const USERS_DB_FILE = 'users.json';

const HOBBIES = ['🎵 Music', '⚽ Sports', '🎬 Movies', '📚 Reading', '🌍 Travel', '🍳 Cooking'];
const LOCATIONS = ['Addis Ababa', 'Mekelle', 'Hawassa', 'Gonder', 'Adama'];
const PLATFORMS = [
  { key: 'telegram', label: 'Telegram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'x', label: 'X (Twitter)' },
  { key: 'other', label: 'Other' }
];

// Persistence
function loadUsers() {
  if (fs.existsSync(USERS_DB_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_DB_FILE));
  }
}
function saveUsers() {
  fs.writeFileSync(USERS_DB_FILE, JSON.stringify(users, null, 2));
}
loadUsers();

// MAIN MENU
function mainMenuKeyboard(user) {
  return Markup.keyboard([
    ['👀 See Matches'],
    ['👤 Show Profile', '✏️ Edit Profile'],
    ['💬 Help', '🛠 Support']
  ]).resize();
}
function getHobbyKeyboard(selected = []) {
  return Markup.inlineKeyboard(
    [
      ...HOBBIES.map(hobby => [
        Markup.button.callback(
          selected.includes(hobby) ? `✅ ${hobby}` : `🏷️ ${hobby}`,
          `toggle_hobby_${hobby.replace(/[^\w]/g, '')}`
        )
      ]),
      [Markup.button.callback('Other...', 'hobby_other')],
      [Markup.button.callback('Done', 'hobbies_done')]
    ]
  );
}
function editProfileKeyboard(user) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`📝 Name: ${user.name || ''}`, 'edit_name')],
    [Markup.button.callback(`🚻 Gender: ${user.gender || ''}`, 'edit_gender')],
    [Markup.button.callback(`🎂 Age: ${user.age || ''}`, 'edit_age')],
    [Markup.button.callback(`📍 Location: ${user.location || ''}`, 'edit_location')],
    [Markup.button.callback(`🏷️ Hobbies: ${(user.hobbies || []).join(', ')}`, 'edit_hobbies')],
    [Markup.button.callback('💡 Bio', 'edit_bio')],
    [Markup.button.callback('📸 Profile Picture', 'edit_photo')],
    [Markup.button.callback(
      `🔗 Username: ${user.custom_username || user.username || ''} (${user.username_platform_label || user.username_platform || ''})`,
      'edit_user_platform')],
    [Markup.button.callback('❌ Cancel', 'edit_cancel')],
    [Markup.button.callback('✅ Done', 'edit_done')]
  ]);
}
function validateAge(age) {
  return typeof age === 'number' && age >= 16 && age <= 45;
}
function validateString(input) {
  return typeof input === 'string' && input.trim().length > 1;
}
function findMatches(me, location) {
  return Object.values(users).filter(u =>
    u.step === 'DONE' &&
    u.gender !== me.gender &&
    u.gender &&
    validateAge(u.age) &&
    u.location === location
  );
}
function formatMatchCaption(match) {
  return `👤 Name: ${match.name}
🚻 Gender: ${match.gender}` +
    (match.age_visible !== false ? `\n🎂 Age: ${match.age}` : '') +
    `\n📍 Location: ${match.location}
🏷️ Hobbies: ${Array.isArray(match.hobbies) ? match.hobbies.join(', ') : match.hobbies}
💡 Bio: ${match.bio}`;
}
function sendMatchSummary(ctx, match) {
  const caption = formatMatchCaption(match);
  const replyMarkup = Markup.inlineKeyboard([
    [Markup.button.callback('📞 See Contact', `reveal_contact_${match.id}`)]
  ]);
  if (match.photo) {
    ctx.replyWithPhoto(match.photo, { caption, ...replyMarkup });
  } else {
    ctx.reply(caption, replyMarkup);
  }
}

// ===== ONBOARDING: WELCOME, CONSENT, SIGN UP =====
bot.start(async ctx => {
  await ctx.reply('💖 Welcome to LoveMatchBot! Ready to meet new people?');
  await ctx.reply(
    "🔒 By using this bot, you agree your profile info will be shown to other users for matching."
  );

  if (!users[ctx.from.id] || !users[ctx.from.id].name) {
    return ctx.reply(
      'Tap below to begin your journey:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Sign Up', 'begin_signup')]
      ])
    );
  }
  return ctx.reply('👋 Welcome back! Use the menu below.', mainMenuKeyboard(users[ctx.from.id]));
});

// Sign Up button action
bot.action('begin_signup', async ctx => {
  users[ctx.from.id] = { id: ctx.from.id, step: 'NAME', hobbies: [] };
  saveUsers();
  await ctx.answerCbQuery();
  ctx.reply('📝 Let’s start with your name:');
});

// === PROFILE CREATION & MATCH BROADCASTING ===
bot.on('photo', ctx => {
  const user = users[ctx.from.id];
  if (!user) return;
  const photos = ctx.message.photo;
  if (!photos || !photos.length) {
    return ctx.reply('🚫 No photo received. Please try again.');
  }
  user.photo = photos[photos.length - 1].file_id;
  if (user.step === 'EDIT_PHOTO') {
    user.step = 'EDITING';
    ctx.reply('📸 Photo updated!', editProfileKeyboard(user));
    saveUsers();
    return;
  }
  user.step = 'DONE';
  saveUsers();
  ctx.reply('👍 Profile complete! Use the menu below.', mainMenuKeyboard(user));
  // Notify new potential matches
  Object.values(users).forEach(waitingUser => {
    if (
      waitingUser.id !== user.id &&
      waitingUser.step === 'DONE' &&
      waitingUser.gender !== user.gender &&
      validateAge(waitingUser.age) &&
      validateAge(user.age)
    ) {
      let alreadySeen =
        (waitingUser.previewMatches && waitingUser.previewMatches.includes(user.id));
      if (!alreadySeen) {
        if (!waitingUser.previewMatches) waitingUser.previewMatches = [];
        waitingUser.previewMatches.push(user.id);
        saveUsers();
        bot.telegram.sendMessage(
          waitingUser.id,
          "👫 New match found! Someone new just finished their profile. Tap 👀 See Matches to check."
        );
      }
    }
  });
});

/* ===== MAIN MENU BUTTONS ===== */
bot.hears('👀 See Matches', ctx => {
  const user = users[ctx.from.id];
  if (!user || user.step !== 'DONE') {
    return ctx.reply('⚠️ Please complete your profile first!');
  }
  // Block during editing
  if (user.step === 'EDITING') {
    return ctx.reply('✏️ Please finish editing your profile before viewing matches. Continue editing below:', editProfileKeyboard(user));
  }
  user.matchStep = 'MATCH_LOCATION';
  saveUsers();
  return ctx.reply(
    '🌍 Where do you want your date to be from?',
    Markup.inlineKeyboard([
      ...LOCATIONS.map(loc => [Markup.button.callback(loc, `match_location_${loc.replace(/ /g, '_')}`)]),
      [Markup.button.callback('Other...', 'match_location_other')]
    ])
  );
});

bot.hears('👤 Show Profile', ctx => {
  const user = users[ctx.from.id];
  if (!user || user.step !== 'DONE') {
    ctx.reply('⚠️ Please complete your profile first!');
    return;
  }
  // Block during editing
  if (user.step === 'EDITING') {
    return ctx.reply('✏️ Please finish editing your profile before viewing your profile. Continue editing below:', editProfileKeyboard(user));
  }
  // Always show age for self
  const caption = `👤 Name: ${user.name}
🚻 Gender: ${user.gender}
🎂 Age: ${user.age}
📍 Location: ${user.location}
🏷️ Hobbies: ${Array.isArray(user.hobbies) ? user.hobbies.join(', ') : user.hobbies}
💡 Bio: ${user.bio}` +
    (user.username || user.custom_username
      ? `\n🔗 Username: ${user.custom_username || user.username} (${user.username_platform_label || 'Telegram'})` : '');
  if (user.photo) {
    ctx.replyWithPhoto(user.photo, { caption });
  } else {
    ctx.reply(caption);
  }
});
bot.hears('✏️ Edit Profile', ctx => {
  const user = users[ctx.from.id];
  if (!user || user.step !== 'DONE') {
    ctx.reply('⚠️ Please complete your profile first!');
    return;
  }
  user.step = 'EDITING';
  ctx.reply('✏️ Select the field you want to edit:', editProfileKeyboard(user));
});
bot.hears('💬 Help', ctx => {
  ctx.reply('ℹ️ Complete your profile and tap 👀 See Matches!');
});
bot.hears('🛠 Support', ctx => {
  ctx.reply('💬 Contact support: @YourSupportHandle');
});
bot.action('edit_cancel', ctx => {
  users[ctx.from.id].step = 'DONE';
  ctx.answerCbQuery('Edit cancelled');
  ctx.reply('❌ Edit cancelled. Back to main menu:', mainMenuKeyboard(users[ctx.from.id]));
  saveUsers();
});

/* ===== PROFILE FLOW (TEXT FIELDS ONLY WHEN EXPECTED) ===== */
bot.on('text', async ctx => {
  const user = users[ctx.from.id];
  // Not registered
  if (!user) {
    return ctx.reply(
      '👋 Please sign up first to use the bot.',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Sign Up', 'begin_signup')]
      ])
    );
  }
  // Match location step
  if (user.matchStep === 'MATCH_LOCATION_TYPED') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("🌍 Please enter a valid location.");
    }
    user.matchLocation = ctx.message.text.trim();
    user.matchStep = null;
    saveUsers();
    showLocationMatches(ctx, user, user.matchLocation);
    return;
  }
  // Profile creation steps
  if (user.step === 'NAME') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("📝 Let's continue with your profile creation. Please enter your name (at least 2 characters).");
    }
    user.name = ctx.message.text.trim();
    user.step = 'GENDER';
    saveUsers();
    return ctx.reply(
      '🚻 Select your gender:',
      Markup.inlineKeyboard([
        [Markup.button.callback('♂️ Male', 'gender_male'), Markup.button.callback('♀️ Female', 'gender_female')]
      ])
    );
  }
  if (user.step === 'GENDER') {
    return ctx.reply("🚻 Let's continue with your profile creation. Please select your gender using the buttons above.");
  }
  if (user.step === 'AGE') {
    const age = parseInt(ctx.message.text, 10);
    if (isNaN(age) || !validateAge(age)) {
      return ctx.reply("🎂 Let's continue with your profile creation. Please enter your age (16-45).");
    }
    user.age = age;
    user.step = 'AGE_PRIVACY';
    saveUsers();
    return ctx.reply(
      '👀 Should your age be visible to others?',
      Markup.inlineKeyboard([
        [Markup.button.callback('Yes', 'age_visible_yes')],
        [Markup.button.callback('No', 'age_visible_no')]
      ])
    );
  }
  if (user.step === 'AGE_PRIVACY') {
    return ctx.reply("👀 Please choose if your age should be visible to others using the buttons above.");
  }
  if (user.step === 'LOCATION_TYPED') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("📍 Please enter a valid location.");
    }
    user.location = ctx.message.text.trim();
    user.step = 'HOBBIES';
    saveUsers();
    return ctx.reply(
      '🏷️ Select your hobbies (tap to toggle, then press Done):',
      getHobbyKeyboard(user.hobbies)
    );
  }
  if (user.step === 'LOCATION') {
    return ctx.reply("📍 Please select your location using the buttons above or tap 'Other...' to type your location.");
  }
  // Hobbies section (manual entry)
  if (user.step === 'HOBBY_TYPED' || user.step === 'EDIT_HOBBY_TYPED') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply('🏷️ Please enter a valid hobby.');
    }
    if (user.hobbies.length >= 5) {
      user.step = user.step === 'EDIT_HOBBY_TYPED' ? 'EDIT_HOBBIES' : 'HOBBIES';
      saveUsers();
      return ctx.reply('❌ You can select up to 5 hobbies only. Remove one to add another.', getHobbyKeyboard(user.hobbies));
    }
    user.hobbies.push(ctx.message.text.trim());
    user.step = user.step === 'EDIT_HOBBY_TYPED' ? 'EDIT_HOBBIES' : 'HOBBIES';
    saveUsers();
    ctx.reply(`🏷️ Added hobby: ${ctx.message.text.trim()}`, getHobbyKeyboard(user.hobbies));
    return;
  }
  // Bio step
  if (user.step === 'BIO') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("💡 Let's continue with your profile creation. Please enter a short bio (at least 2 characters).");
    }
    user.bio = ctx.message.text.trim();
    if (ctx.from.username) {
      user.username = ctx.from.username;
      user.username_platform = 'telegram';
      user.username_platform_label = 'Telegram';
      user.step = 'PHOTO';
      saveUsers();
      return ctx.reply('📸 Please send your profile picture:');
    } else {
      user.step = 'CUSTOM_USERNAME';
      saveUsers();
      return ctx.reply('👀 We couldn\'t find your Telegram username. Please enter a username you want displayed in your profile:');
    }
  }
  // Custom username step
  if (user.step === 'CUSTOM_USERNAME') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("🔗 Let's continue with your profile creation. Please enter a username.");
    }
    user.custom_username = ctx.message.text.trim();
    user.step = 'USERNAME_PLATFORM';
    saveUsers();
    return ctx.reply('📱 Where is this username from?', Markup.inlineKeyboard(
      PLATFORMS.map(p => [Markup.button.callback(p.label, `username_source_${p.key}`)])
    ));
  }
  // Custom platform step
  if (user.step === 'CUSTOM_PLATFORM') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("🗂 Let's continue with your profile creation. Please enter the platform name.");
    }
    user.username_platform = ctx.message.text.trim();
    user.username_platform_label = ctx.message.text.trim();
    user.step = 'PHOTO';
    saveUsers();
    ctx.reply('📸 Please send your profile picture:');
    return;
  }
  // Edit Steps
  if (user.step === 'EDIT_NAME') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply('📝 Please enter a valid name.');
    }
    user.name = ctx.message.text.trim();
    user.step = 'EDITING';
    ctx.reply('📝 Name updated!', editProfileKeyboard(user));
    saveUsers();
  } else if (user.step === 'EDIT_AGE') {
    const age = parseInt(ctx.message.text, 10);
    if (isNaN(age) || !validateAge(age))
      return ctx.reply('🎂 Age must be a number between 16 and 45.');
    user.age = age;
    user.step = 'EDITING';
    ctx.reply('🎂 Age updated!', editProfileKeyboard(user));
    saveUsers();
  } else if (user.step === 'EDIT_BIO') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply('💡 Bio cannot be empty.');
    }
    user.bio = ctx.message.text.trim();
    user.step = 'EDITING';
    ctx.reply('💡 Bio updated!', editProfileKeyboard(user));
    saveUsers();
  } else if (user.step === 'EDIT_USERNAME') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply('🔗 Username cannot be empty.');
    }
    user.custom_username = ctx.message.text.trim();
    user.step = 'EDIT_USERNAME_PLATFORM';
    ctx.reply(
      '📱 Where is this username from?',
      Markup.inlineKeyboard(
        PLATFORMS.map(p => [Markup.button.callback(p.label, `set_edit_username_source_${p.key}`)])
      )
    );
    saveUsers();
  } else if (user.step === 'EDIT_CUSTOM_PLATFORM') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply('🗂 Platform name cannot be empty.');
    }
    user.username_platform = ctx.message.text.trim();
    user.username_platform_label = ctx.message.text.trim();
    user.step = 'EDITING';
    ctx.reply('🗂 Platform updated!', editProfileKeyboard(user));
    saveUsers();
  } else if (user.step === 'EDIT_LOCATION_TYPED') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply("📍 Please enter a valid location.");
    }
    user.location = ctx.message.text.trim();
    user.step = 'EDITING';
    saveUsers();
    ctx.reply(`📍 Location updated to: ${user.location}`, editProfileKeyboard(user));
    return;
  }
  // Hobbies edit manual entry
  if (user.step === 'EDIT_HOBBY_TYPED') {
    if (!validateString(ctx.message.text)) {
      return ctx.reply('🏷️ Please enter a valid hobby.');
    }
    if (user.hobbies.length >= 5) {
      user.step = 'EDIT_HOBBIES';
      saveUsers();
      return ctx.reply('❌ You can select up to 5 hobbies only. Remove one to add another.', getHobbyKeyboard(user.hobbies));
    }
    user.hobbies.push(ctx.message.text.trim());
    user.step = 'EDIT_HOBBIES';
    saveUsers();
    ctx.reply(`🏷️ Added hobby: ${ctx.message.text.trim()}`, getHobbyKeyboard(user.hobbies));
    return;
  }
  // If user is in profile creation and text is unexpected, guide them
  if (
    user.step !== 'DONE' &&
    user.step !== 'EDITING' &&
    user.step !== 'EDIT_NAME' &&
    user.step !== 'EDIT_AGE' &&
    user.step !== 'EDIT_BIO' &&
    user.step !== 'EDIT_USERNAME' &&
    user.step !== 'EDIT_CUSTOM_PLATFORM' &&
    user.step !== 'EDIT_USERNAME_PLATFORM' &&
    user.step !== 'EDIT_HOBBIES' &&
    user.step !== 'EDIT_PHOTO' &&
    user.step !== 'EDIT_LOCATION' &&
    user.step !== 'EDIT_LOCATION_TYPED'
  ) {
    return ctx.reply("🤖 Let's continue with your profile creation. Follow the prompts to complete your profile.");
  }
  // If user is editing or done, show main menu for unexpected input
  return ctx.reply(
    '🤖 I didn’t understand that. Use the menu or tap 📝 Sign Up to begin!',
    mainMenuKeyboard(user)
  );
});

/* --- Inline: genders/hobbies/edits/location/age privacy etc --- */
bot.action(/gender_(.+)/, ctx => {
  ctx.answerCbQuery();
  const gender = ctx.match[1];
  const user = users[ctx.from.id];
  if (!user || user.step !== 'GENDER') return;
  user.gender = gender;
  user.step = 'AGE';
  saveUsers();
  ctx.editMessageText(`🚻 Selected gender: ${gender.charAt(0).toUpperCase() + gender.slice(1)}`);
  ctx.reply('🎂 Enter your age (16-45):');
});
bot.action('age_visible_yes', ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || user.step !== 'AGE_PRIVACY') return;
  user.age_visible = true;
  user.step = 'LOCATION';
  saveUsers();
  ctx.editMessageText('🎂 Your age will be visible to others.');
  ctx.reply(
    '📍 Select your location:',
    Markup.inlineKeyboard([
      ...LOCATIONS.map(loc => [Markup.button.callback(loc, `location_${loc.replace(/ /g, '_')}`)]),
      [Markup.button.callback('Other...', 'location_other')]
    ])
  );
});
bot.action('age_visible_no', ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || user.step !== 'AGE_PRIVACY') return;
  user.age_visible = false;
  user.step = 'LOCATION';
  saveUsers();
  ctx.editMessageText('🎂 Your age will NOT be visible to others.');
  ctx.reply(
    '📍 Select your location:',
    Markup.inlineKeyboard([
      ...LOCATIONS.map(loc => [Markup.button.callback(loc, `location_${loc.replace(/ /g, '_')}`)]),
      [Markup.button.callback('Other...', 'location_other')]
    ])
  );
});
LOCATIONS.forEach(loc => {
  bot.action(`location_${loc.replace(/ /g, '_')}`, ctx => {
    ctx.answerCbQuery();
    const user = users[ctx.from.id];
    if (!user || user.step !== 'LOCATION') return;
    user.location = loc;
    user.step = 'HOBBIES';
    saveUsers();
    ctx.editMessageText(`📍 Selected location: ${loc}`);
    ctx.reply(
      '🏷️ Select your hobbies (tap to toggle, then press Done):',
      getHobbyKeyboard(user.hobbies)
    );
  });
});
bot.action('location_other', ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || user.step !== 'LOCATION') return;
  user.step = 'LOCATION_TYPED';
  saveUsers();
  ctx.reply("📍 Please type your city or location:");
});
bot.action(/toggle_hobby_(.+)/, async ctx => {
  ctx.answerCbQuery();
  const hobbyRaw = ctx.match[1];
  const hobby = HOBBIES.find(h => h.replace(/[^\w]/g, '') === hobbyRaw) || hobbyRaw;
  const user = users[ctx.from.id];
  if (!user || (user.step !== 'HOBBIES' && user.step !== 'EDIT_HOBBIES')) return;
  if (user.hobbies.includes(hobby)) {
    user.hobbies = user.hobbies.filter(h => h !== hobby);
    saveUsers();
    await ctx.editMessageReplyMarkup(getHobbyKeyboard(user.hobbies).reply_markup);
  } else {
    if (user.hobbies.length >= 5) {
      return ctx.reply('❌ You can select up to 5 hobbies only. Remove one to add another.');
    }
    user.hobbies.push(hobby);
    saveUsers();
    await ctx.editMessageReplyMarkup(getHobbyKeyboard(user.hobbies).reply_markup);
  }
});
bot.action('hobby_other', async ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || (user.step !== 'HOBBIES' && user.step !== 'EDIT_HOBBIES')) return;
  if (user.hobbies.length >= 5) {
    return ctx.reply('❌ You can select up to 5 hobbies only. Remove one to add another.');
  }
  user.step = user.step === 'EDIT_HOBBIES' ? 'EDIT_HOBBY_TYPED' : 'HOBBY_TYPED';
  saveUsers();
  ctx.reply('🏷️ Please type your hobby:');
});
bot.action('hobbies_done', async ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || (user.step !== 'HOBBIES' && user.step !== 'EDIT_HOBBIES')) return;
  if (!user.hobbies.length)
    return ctx.reply('🏷️ Select at least one hobby!');
  user.step = user.step === 'EDIT_HOBBIES' ? 'EDITING' : 'BIO';
  saveUsers();
  await ctx.editMessageText(`🏷️ Selected hobbies: ${user.hobbies.join(', ')}`);
  if (user.step === 'EDITING')
    return ctx.reply('✏️ Continue editing your profile:', editProfileKeyboard(user));
  return ctx.reply('💡 Write a short bio:');
});
PLATFORMS.forEach(({ key, label }) => {
  bot.action(`username_source_${key}`, ctx => {
    ctx.answerCbQuery();
    const user = users[ctx.from.id];
    if (!user || user.step !== 'USERNAME_PLATFORM') return;
    if (key === 'other') {
      user.step = 'CUSTOM_PLATFORM';
      saveUsers();
      ctx.reply('🗂 Please specify the platform name:');
      return;
    }
    user.username_platform = key;
    user.username_platform_label = label;
    user.step = 'PHOTO';
    saveUsers();
    ctx.editMessageText(`🔗 Username will show as: ${user.custom_username} (${label})`);
    ctx.reply('📸 Please send your profile picture:');
  });
  bot.action(`set_edit_username_source_${key}`, ctx => {
    ctx.answerCbQuery();
    const user = users[ctx.from.id];
    if (!user || user.step !== 'EDIT_USERNAME_PLATFORM') return;
    if (key === 'other') {
      user.step = 'EDIT_CUSTOM_PLATFORM';
      saveUsers();
      ctx.reply('🗂 Please specify the platform name:');
      return;
    }
    user.username_platform = key;
    user.username_platform_label = label;
    user.step = 'EDITING';
    saveUsers();
    ctx.editMessageText(`🔗 Username will show as: ${user.custom_username} (${label})`);
    ctx.reply('✏️ Continue editing your profile:', editProfileKeyboard(user));
  });
});
['edit_name', 'edit_gender', 'edit_age', 'edit_hobbies', 'edit_bio', 'edit_photo', 'edit_user_platform', 'edit_location'].forEach(action => {
  bot.action(action, ctx => {
    ctx.answerCbQuery();
    switch (action) {
      case 'edit_name':
        users[ctx.from.id].step = 'EDIT_NAME';
        ctx.reply('📝 Enter your new name:');
        break;
      case 'edit_gender':
        users[ctx.from.id].step = 'EDIT_GENDER';
        ctx.reply(
          '🚻 Select your (new) gender:',
          Markup.inlineKeyboard([
            [Markup.button.callback('♂️ Male', 'set_edit_gender_male'), Markup.button.callback('♀️ Female', 'set_edit_gender_female')]
          ])
        );
        break;
      case 'edit_age':
        users[ctx.from.id].step = 'EDIT_AGE';
        ctx.reply(`🎂 Your current age is: ${users[ctx.from.id].age}\nEnter your new age (16-45):`);
        break;
      case 'edit_hobbies':
        users[ctx.from.id].step = 'EDIT_HOBBIES';
        ctx.reply(
          '🏷️ Select your hobbies (tap to toggle, then press Done):',
          getHobbyKeyboard(users[ctx.from.id].hobbies)
        );
        break;
      case 'edit_bio':
        users[ctx.from.id].step = 'EDIT_BIO';
        ctx.reply('💡 Enter your new bio:');
        break;
      case 'edit_photo':
        users[ctx.from.id].step = 'EDIT_PHOTO';
        ctx.reply('📸 Please send your new profile picture:');
        break;
      case 'edit_user_platform':
        users[ctx.from.id].step = 'EDIT_USERNAME';
        ctx.reply('🔗 Enter your new profile username:');
        break;
      case 'edit_location':
        users[ctx.from.id].step = 'EDIT_LOCATION';
        ctx.reply(
          '📍 Select your new location:',
          Markup.inlineKeyboard([
            ...LOCATIONS.map(loc => [Markup.button.callback(loc, `set_edit_location_${loc.replace(/ /g, '_')}`)]),
            [Markup.button.callback('Other...', 'set_edit_location_other')]
          ])
        );
        break;
    }
    saveUsers();
  });
});
bot.action(/set_edit_gender_(.+)/, ctx => {
  ctx.answerCbQuery();
  const gender = ctx.match[1];
  const user = users[ctx.from.id];
  if (!user || user.step !== 'EDIT_GENDER') return;
  user.gender = gender;
  user.step = 'EDITING';
  saveUsers();
  ctx.editMessageText(`🚻 Gender updated to: ${gender}`);
  ctx.reply('✏️ Continue editing your profile:', editProfileKeyboard(user));
});
bot.action('edit_done', ctx => {
  const user = users[ctx.from.id];
  if (!user) return;
  user.step = 'DONE';
  ctx.answerCbQuery('Editing complete!');
  ctx.reply('✅ Editing complete! Use the main menu:', mainMenuKeyboard(user));
  saveUsers();
});
LOCATIONS.forEach(loc => {
  bot.action(`set_edit_location_${loc.replace(/ /g, '_')}`, ctx => {
    ctx.answerCbQuery();
    const user = users[ctx.from.id];
    if (!user || user.step !== 'EDIT_LOCATION') return;
    user.location = loc;
    user.step = 'EDITING';
    saveUsers();
    ctx.editMessageText(`📍 Location updated to: ${loc}`);
    ctx.reply('✏️ Continue editing your profile:', editProfileKeyboard(user));
  });
});
bot.action('set_edit_location_other', ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || user.step !== 'EDIT_LOCATION') return;
  user.step = 'EDIT_LOCATION_TYPED';
  saveUsers();
  ctx.reply("📍 Please type your new city or location:");
});

/* ===== SEE MATCHES: LOCATION FILTER ===== */
function showLocationMatches(ctx, user, location) {
  const matches = findMatches(user, location);
  if (!matches.length) {
    return ctx.reply('🔔 No matches found in that location. Try another location or check back later.', mainMenuKeyboard(user));
  }
  matches.forEach(match => sendMatchSummary(ctx, match));
  ctx.reply('👫 Here are your matches:', mainMenuKeyboard(user));
}
LOCATIONS.forEach(loc => {
  bot.action(`match_location_${loc.replace(/ /g, '_')}`, ctx => {
    ctx.answerCbQuery();
    const user = users[ctx.from.id];
    if (!user || user.matchStep !== 'MATCH_LOCATION') return;
    user.matchLocation = loc;
    user.matchStep = null;
    saveUsers();
    showLocationMatches(ctx, user, loc);
  });
});
bot.action('match_location_other', ctx => {
  ctx.answerCbQuery();
  const user = users[ctx.from.id];
  if (!user || user.matchStep !== 'MATCH_LOCATION') return;
  user.matchStep = 'MATCH_LOCATION_TYPED';
  saveUsers();
  ctx.reply("🌍 Please type the city or location you want your date to be from:");
});

/* ===== SEE CONTACT SECURE BY USER ID ===== */
bot.action(/^reveal_contact_(\d+)$/, ctx => {
  ctx.answerCbQuery();
  const matchId = ctx.match[1];
  const match = users[matchId];
  if (!match || match.step !== 'DONE') {
    return ctx.reply('❌ Could not find user contact.');
  }
  ctx.reply(`📞 Contact info:\n${match.custom_username || match.username} (${match.username_platform_label || 'Telegram'})`);
});

/* ===== START BOT ===== */
bot.launch();
console.log('Dating bot running with all requested features!');
