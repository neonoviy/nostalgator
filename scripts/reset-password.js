const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// Генерация случайного пароля
function generatePassword(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function resetPassword(username) {
  try {
    console.log(`\n🔐 Сброс пароля для пользователя: ${username}\n`);

    // Находим пользователя
    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      console.error(`❌ Пользователь "${username}" не найден`);
      process.exit(1);
    }

    // Генерируем временный пароль
    const tempPassword = generatePassword(10);
    console.log(`📝 Сгенерирован временный пароль: ${tempPassword}\n`);

    // Хешируем пароль
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Обновляем в БД
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    console.log('✅ Пароль успешно обновлён в базе данных\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Временный пароль для "${username}":`);
    console.log(`\n   ${tempPassword}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('⚠️  Рекомендуется сменить пароль сразу после входа!\n');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Получаем username из аргументов
const username = process.argv[2];

if (!username) {
  console.log('\n❌ Использование: npm run reset-password <username>\n');
  console.log('Пример: npm run reset-password admin\n');
  process.exit(1);
}

resetPassword(username);
