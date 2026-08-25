const { exiftool } = require('exiftool-vendored');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');

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
 * Извлекает дату из имени файла (YYYYMMDD формат)
 */
function parseDateFromFilename(filename) {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

/**
 * Корректирует дату: 00:00-05:00 → предыдущий день
 */
function adjustDate(date) {
  const hours = date.getHours();
  if (hours >= 0 && hours < 5) {
    // Вычитаем один день
    const adjustedDate = new Date(date);
    adjustedDate.setDate(adjustedDate.getDate() - 1);
    console.log(`  Корректировка даты: ${date.toISOString()} → ${adjustedDate.toISOString()} (время ${hours}:00-05:00)`);
    return adjustedDate;
  }
  return date;
}

/**
 * Получает дату съёмки из EXIF или имени файла
 */
async function getFileDate(filePath) {
  try {
    // Читаем EXIF
    const tags = await exiftool.read(filePath);
    
    // Пробуем разные EXIF теги для даты
    let dateStr = tags.DateTimeOriginal?.toString() || 
                  tags.CreateDate?.toString() || 
                  tags.DateTimeDigitized?.toString();
    
    if (dateStr) {
      // Формат EXIF: "YYYY:MM:DD HH:MM:SS"
      const match = dateStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hours, minutes, seconds] = match;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                             parseInt(hours), parseInt(minutes), parseInt(seconds));
        
        if (!isNaN(date.getTime())) {
          console.log(`  EXIF дата: ${date.toISOString()}`);
          return adjustDate(date);
        }
      }
    }
    
    // Если нет EXIF даты, пробуем имя файла
    console.log('  Нет EXIF даты, пробуем имя файла...');
    const filenameDate = parseDateFromFilename(path.basename(filePath));
    if (filenameDate) {
      console.log(`  Дата из имени файла: ${filenameDate.toISOString()}`);
      return adjustDate(filenameDate);
    }
    
    // Если ничего не нашли, используем дату модификации файла
    console.log('  Нет даты в имени файла, используем дату модификации...');
    const stats = await fs.stat(filePath);
    return adjustDate(stats.mtime);
    
  } catch (error) {
    console.error(`  Ошибка чтения файла ${filePath}: ${error.message}`);
    // Используем дату модификации
    const stats = await fs.stat(filePath);
    return adjustDate(stats.mtime);
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
    await fs.rename(filePath, newDestPath);
    console.log(`  Перемещено: ${filePath} → ${newDestPath}`);
  } else {
    await fs.rename(filePath, destPath);
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
