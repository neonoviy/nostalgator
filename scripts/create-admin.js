const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdminUser(authService) {
  try {
    console.log('Создание пользователя admin...');
    
    // Проверяем, существует ли уже админ
    const existingAdmin = await authService.prisma.user.findFirst({
      where: { role: 'admin' }
    });
    
    if (existingAdmin) {
      console.log('Пользователь admin уже существует');
      return;
    }
    
    // Хешируем пароль
    const passwordHash = await authService.hashPassword('admin');
    
    // Создаём админа
    const admin = await authService.prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        role: 'admin'
      }
    });
    
    console.log(`Админ создан: id=${admin.id}, username=${admin.username}, role=${admin.role}`);
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// Если скрипт запущен напрямую — создаём админа
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const authService = { prisma, hashPassword: async (p) => require('bcrypt').hash(p, 10) };
  createAdminUser(authService).then(() => prisma.$disconnect());
}

module.exports = { createAdminUser };
