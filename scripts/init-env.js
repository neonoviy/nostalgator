const fs = require('fs');
const path = require('path');

// Проверяем существование .env файла
const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.log('Файл .env не найден, создаем из .env.example...');
  
  const examplePath = path.join(__dirname, '..', '.env.example');
  
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('Файл .env создан успешно!');
  } else {
    // Создаем минимальный .env файл
    const minimalEnv = `
# Пути к папкам
ORIGINALS_PATH=./Originals
THUMBNAILS_PATH=./Thumbnails

# Порты серверов
SERVER_PORT=3001
CLIENT_PORT=3000

# Режим разработки
NODE_ENV=development
`;
    
    fs.writeFileSync(envPath, minimalEnv.trim());
    console.log('Минимальный файл .env создан успешно!');
  }
} else {
  console.log('Файл .env уже существует');
}

// Проверяем существование папок
const originalsPath = path.join(__dirname, '..', 'Originals');
const thumbnailsPath = path.join(__dirname, '..', 'Thumbnails');

if (!fs.existsSync(originalsPath)) {
  fs.mkdirSync(originalsPath, { recursive: true });
  console.log('Папка Originals создана');
}

if (!fs.existsSync(thumbnailsPath)) {
  fs.mkdirSync(thumbnailsPath, { recursive: true });
  console.log('Папка Thumbnails создана');
}