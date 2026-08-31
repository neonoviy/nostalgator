const { exiftool } = require('exiftool-vendored');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { parseImportDate } = require('../src/server/utils/fileUtils');

dotenv.config();

const IMPORT_PATH = process.env.IMPORT_PATH || './Import';
const ORIGINALS_PATH = process.env.ORIGINALS_PATH || './Originals';
const FOLDER_FORMAT = process.env.FOLDER_FORMAT || 'MM.DD';

// Поддерживаемые форматы папок
const SUPPORTED_FORMATS = ['MM.DD', 'YYYY-MM-DD', 'YYYY.MM.DD'];

/**
 * Форматирует дату в нужный формат папки
 */
function formatFolderName(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (format) {
    case 'MM.DD':
      return `${month}.${day}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'YYYY.MM.DD':
      return `${year}.${month}.${day}`;
    default:
      return `${month}.${day}`;
  }
}

/**
 * Получает дату съёмки из файла (обёртка вокруг общего парсера)
 */
async function getFileDate(filePath) {
  try {
    const date = await parseImportDate(filePath)
    console.log(`  Дата съёмки: ${date.toISOString()}`)
    return date
  } catch (error) {
    console.error(`  Ошибка чтения файла ${filePath}: ${error.message}`)
    const stats = await fs.stat(filePath)
    return new Date(stats.mtime)
  }
}

/**
 * Рекурсивно сканирует папку Import
 */
async function scanImportDir(importPath) {
  console.log(`\n📁 Сканирование папки Import: ${importPath}`);
  
  const files = [];
  
  async function scanDir(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else {
        // Проверяем, что это медиафайл
        const ext = path.extname(entry.name).toLowerCase();
        const mediaExts = ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.avi', '.mkv', '.heic', '.heif'];
        
        if (mediaExts.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  
  await scanDir(importPath);
  return files;
}

/**
 * Перемещает файл с fallback copy+unlink при EXDEV
 */
async function safeMove(src, dest) {
  try {
    await fs.rename(src, dest)
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.copyFile(src, dest)
      await fs.unlink(src)
    } else {
      throw err
    }
  }
}

/**
 * Перемещает файл в нужную папку
 */
async function moveFile(filePath, date) {
  const year = date.getFullYear();
  const folderName = formatFolderName(date, FOLDER_FORMAT);
  
  // Создаём путь: Originals/YYYY/FOLDER_NAME/
  const yearPath = path.join(ORIGINALS_PATH, year.toString());
  const folderPath = path.join(yearPath, folderName);
  
  // Создаём папки, если не существуют
  await fs.mkdir(yearPath, { recursive: true });
  await fs.mkdir(folderPath, { recursive: true });
  
  // Перемещаем файл
  const fileName = path.basename(filePath);
  const destPath = path.join(folderPath, fileName);
  
  // Проверяем дубликаты
  if (await fs.access(destPath).then(() => true).catch(() => false)) {
    console.log(`  Файл уже существует: ${destPath}, перемещаем с новым именем`);
    const name = path.parse(fileName).name;
    const ext = path.extname(fileName);
    const newFileName = `${name}_${Date.now()}${ext}`;
    const newDestPath = path.join(folderPath, newFileName);
    await safeMove(filePath, newDestPath);
    console.log(`  Перемещено: ${filePath} → ${newDestPath}`);
  } else {
    await safeMove(filePath, destPath);
    console.log(`  Перемещено: ${filePath} → ${destPath}`);
  }
  
  return folderPath;
}

/**
 * Основная функция импорта
 */
async function importFiles() {
  console.log('🚀 Запуск импорта файлов');
  console.log(`IMPORT_PATH: ${IMPORT_PATH}`);
  console.log(`ORIGINALS_PATH: ${ORIGINALS_PATH}`);
  console.log(`FOLDER_FORMAT: ${FOLDER_FORMAT}`);
  
  // Проверяем существование папки Import
  try {
    await fs.access(IMPORT_PATH);
  } catch (error) {
    console.error(`❌ Папка Import не найдена: ${IMPORT_PATH}`);
    process.exit(1);
  }
  
  // Сканируем папку
  const files = await scanImportDir(IMPORT_PATH);
  console.log(`\n📄 Найдено файлов: ${files.length}`);
  
  if (files.length === 0) {
    console.log('✅ Нет файлов для импорта');
    return;
  }
  
  // Перемещаем файлы
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of files) {
    try {
      console.log(`\n📷 Обработка: ${file}`);
      const date = await getFileDate(file);
      console.log(`  Дата съёмки: ${date.toISOString()}`);
      
      const folderPath = await moveFile(file, date);
      console.log(`  Папка назначения: ${folderPath}`);
      
      successCount++;
    } catch (error) {
      console.error(`  ❌ Ошибка: ${error.message}`);
      errorCount++;
    }
  }
  
  // Итоги
  console.log('\n' + '='.repeat(50));
  console.log('✅ Импорт завершён');
  console.log(`Успешно: ${successCount}`);
  console.log(`Ошибки: ${errorCount}`);
  console.log('='.repeat(50));
  
  // Закрываем exiftool
  await exiftool.end();
}

// Запуск
importFiles().catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});
