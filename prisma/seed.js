/**
 * Seed script — создаёт начальные данные в БД
 * Запуск: npm run db:seed
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Настройки (если нет)
  const settings = await prisma.setting.findFirst();
  if (!settings) {
    await prisma.setting.create({
      data: {
        originalsPath: process.env.ORIGINALS_PATH || './Originals',
        thumbnailsPath: process.env.THUMBNAILS_PATH || './Thumbnails',
        originalsWatchEnabled: true,
        importWatchEnabled: true
      }
    });
    console.log('✅ Settings created');
  }

  // 2. Админ (если нет)
  let admin = await prisma.user.findFirst({
    where: { role: 'admin' }
  });

  if (!admin) {
    const passwordHash = await bcrypt.hash('admin', 10);
    admin = await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        role: 'admin'
      }
    });
    console.log('✅ Admin user created (password: admin)');
  } else {
    console.log('ℹ️  Admin user already exists');
  }

  console.log('🌱 Seeding complete');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
