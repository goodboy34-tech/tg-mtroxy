# 🐛 Исправление TypeScript ошибок

## Проблемы и решения

### ❌ Проблема 1: TS4023 - Export name conflict

```
error TS4023: Exported variable 'queries' has or is using name 'BetterSqlite3.Statement' 
from external module but cannot be named.
```

**Причина:** TypeScript не может вывести типы для экспортируемого объекта `queries`.

**Решение:** Добавлена явная типизация для объекта queries в `control-panel/src/database.ts`:

```typescript
import type Database from 'better-sqlite3';

// Добавлен тип для queries
type QueryCollection = {
  [key: string]: Database.Statement<any[]>;
};

export const queries: QueryCollection = {
  // ... все запросы
};
```

**Коммит:** `fix: Добавлена явная типизация для queries в database.ts`

---

### ❌ Проблема 2: TS2554 - Expected 1 arguments, but got 0

```
error TS2554: Expected 1 arguments, but got 0.

queries.getAllNodes.all()
                    ~~~
Arguments for the rest parameter 'params' were not provided.
```

**Причина:** Новая версия `@types/better-sqlite3` требует явно передавать параметры даже для запросов без параметров.

**Решение:** Добавлен пустой массив `[]` для всех вызовов `.all()` и `.run()` без параметров в `control-panel/src/bot.ts`:

```typescript
// Было:
const nodes = queries.getAllNodes.all();
queries.cleanOldStats.run();

// Стало:
const nodes = queries.getAllNodes.all([]);
queries.cleanOldStats.run([]);
```

**Исправлено 9 ошибок:**
1. Line 116: `queries.getAllNodes.all()` → `queries.getAllNodes.all([])`
2. Line 528: `queries.getActiveNodes.all()` → `queries.getActiveNodes.all([])`
3. Line 529: `queries.getAllNodesLatestStats.all()` → `queries.getAllNodesLatestStats.all([])`
4. Line 555: `queries.getActiveNodes.all()` → `queries.getActiveNodes.all([])`
5. Line 708: `queries.getActiveNodes.all()` → `queries.getActiveNodes.all([])`
6. Line 740: `queries.getAllSubscriptions.all()` → `queries.getAllSubscriptions.all([])`
7. Line 1004: `queries.getActiveNodes.all()` → `queries.getActiveNodes.all([])`
8. Line 1054: `queries.cleanOldStats.run()` → `queries.cleanOldStats.run([])`
9. Line 1055: `queries.cleanOldLogs.run()` → `queries.cleanOldLogs.run([])`

**Коммит:** `fix: Исправлены вызовы .all() и .run() для better-sqlite3`

---

## ✅ Итог

Все TypeScript ошибки исправлены! Проект теперь корректно компилируется с:
- `better-sqlite3@^11.7.0`
- `@types/better-sqlite3@^7.6.12`
- `typescript@^5.7.0`

---

## 📋 Проверка компиляции

### На Linux/macOS:

```bash
cd control-panel
npm install
npm run build
```

### На Windows:

Для компиляции `better-sqlite3` на Windows требуется:
- Visual Studio 2022 Build Tools
- Python 3.x
- node-gyp

**Альтернатива для Windows:**
```bash
# Установка только dev-зависимостей (без better-sqlite3)
cd control-panel
npm install --only=dev

# Проверка TypeScript
npx tsc --noEmit
```

**Для production:** Используйте Docker или установку на Linux-сервере.

---

## 🔗 Связанные коммиты

1. `fix: Добавлена явная типизация для queries в database.ts` - bfa9e09
2. `fix: Исправлены вызовы .all() и .run() для better-sqlite3` - 4b7e9f8

---

## 📚 Документация

- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Linux Build Instructions](./LINUX-BUILD.md)

---

**Все проблемы решены!** ✅
