/**
 * Запуск всех E2E тестов.
 *
 * Что делает:
 * 1. Запускает 01 (проверит что сервер потушен, очистит, поднимет dev-all, сканирует)
 * 2. Запускает 02-05 последовательно
 * 3. Dev-all остаётся живым → http://localhost:3000
 *
 * ВАЖНО: Перед запуском сервер должен быть ПОТУШЕН!
 *
 * Запуск:
 *   node test-e2e\run-all.js
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

function log(msg, color = '') {
  console.log(`${color}${msg}${C.reset}`);
}

function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min > 0) return `${min}м ${s}с`;
  return `${s}с`;
}

async function runTest(testFile) {
  // Для теста 04 используем exec (обходит IPC баг spawn Node 22)
  if (testFile.includes('04-scanning')) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const normalized = testFile.replace(/\//g, path.sep);
      exec(`node --test "${normalized}"`, { cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        resolve(err === null);
      });
    });
  }

  const child = spawn('node', ['--test', testFile], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit']
  });
  return new Promise((resolve) => {
    child.on('close', (code) => resolve(code === 0));
  });
}

async function main() {
  log('╔══════════════════════════════════════════════╗', C.cyan);
  log('║       Ностальгатор E2E Test Runner           ║', C.cyan);
  log('╚══════════════════════════════════════════════╝', C.cyan);
  log('');

  const overallStart = Date.now();

  const tests = [
    { name: '01:  Первый запуск',      file: 'test-e2e/01-first-launch.test.js' },
    { name: '01b: Генерация тегов',    file: 'test-e2e/01b-tags-seeding.test.js' },
    { name: '02:  События',            file: 'test-e2e/02-events.test.js' },
    { name: '03:  Проверка тегов',     file: 'test-e2e/03-tags.test.js' },
    { name: '04:  Сканирование',       file: 'test-e2e/04-scanning.test.js' },
    { name: '05:  Пользователи',       file: 'test-e2e/05-users.test.js' }
  ];

  const results = [];
  for (const test of tests) {
    log('');
    log(`═══════════════════════════════════════════════`, C.cyan);
    log(`${C.bold}[Тест] ${test.name}${C.reset}`, C.cyan);
    log(`═══════════════════════════════════════════════`, C.cyan);

    const testStart = Date.now();
    const passed = await runTest(test.file);
    const elapsed = Date.now() - testStart;
    results.push({ ...test, passed, elapsed });

    log('');
    log(`  ⏱️  ${formatTime(elapsed)}`, C.dim);
    if (passed) {
      log(`  ✅ ${test.name} — пройден`, C.green);
    } else {
      log(`  ❌ ${test.name} — ПРОВАЛЕН`, C.red);
    }
  }

  const overallElapsed = Date.now() - overallStart;

  // Итог
  log('');
  log('═══════════════════════════════════════════════', C.cyan);
  log(`${C.bold}ИТОГО:${C.reset}`, C.bold);
  const passedCount = results.filter(r => r.passed).length;
  for (const r of results) {
    const icon = r.passed ? `${C.green}✅${C.reset}` : `${C.red}❌${C.reset}`;
    log(`  ${icon} ${r.name.padEnd(25)} ${formatTime(r.elapsed).padStart(8)}`);
  }
  log(`  ──────────────────────────────────────────`);
  log(`  ${passedCount}/${results.length} тестов прошли за ${formatTime(overallElapsed)}`, passedCount === results.length ? C.green : C.red);
  log('═══════════════════════════════════════════════', C.cyan);
  log('');

  if (passedCount === results.length) {
    log(`${C.green}${C.bold}🎉 Все тесты прошли!${C.reset}`, C.green);
  } else {
    log(`${C.red}⚠️  Есть проваленные тесты${C.reset}`, C.red);
  }

  log(`\n  Фронт:  ${C.cyan}http://localhost:3000${C.reset}`);
  log(`  API:    ${C.cyan}http://localhost:3001${C.reset}`);
  log(`  Swagger:${C.cyan} http://localhost:3001/api-docs${C.reset}`);
  log(`  ${C.dim}Сервер и фронт работают — можно проверять вручную.${C.reset}`);
  log(`  ${C.dim}Ctrl+C для остановки (убьёт все node-процессы).${C.reset}\n`);

  // При Ctrl+C убиваем все node-процессы (dev-all)
  process.on('SIGINT', () => {
    log('\n  🛑 Остановка всех node-процессов...', C.yellow);
    try { execSync('taskkill /F /IM node.exe 2>nul', { stdio: 'ignore' }); } catch {}
    log('  ✅ Готово', C.green);
    process.exit(0);
  });

  // Держим процесс живым
  process.stdin.resume();
  await new Promise(() => {});
}

main().catch(err => {
  log(`\n${C.red}Ошибка: ${err.message}${C.reset}`, C.red);
  process.exit(1);
});
