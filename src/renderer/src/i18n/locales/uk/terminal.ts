import type { TerminalArea } from '../en/terminal'

export const terminal: TerminalArea = {
  'status.running': 'працює',
  'status.waiting': 'чекає на вас',
  'status.idle': 'простоює',
  'status.asleep': 'спить — клік розбудить і продовжить з того самого місця',
  'status.dead': 'процес завершено',

  'tabs.aria': 'Вкладки сесії',
  'tab.agent': 'Агент',
  'tab.aria': '{title} — {status}',
  'tab.hint': '{status} · середня кнопка миші — закрити',
  'tab.hintAgent': '{status} · {command} · середня кнопка миші — закрити',
  'tab.name.aria': 'Назва вкладки',
  'tab.close': 'Закрити термінал',
  'tab.close.aria': 'Закрити вкладку «{title}»',

  'add.title': 'Нова вкладка: {what} (Ctrl+T)',
  'add.other': 'Інший агент',
  'add.other.aria': 'Вибрати агента для нової вкладки',
  'add.menu.aria': 'Чим відкрити нову вкладку',

  'menu.rename': 'Перейменувати',
  'menu.rename.hint': 'подвійний клік',
  'menu.close': 'Закрити вкладку',
  'menu.close.hint': 'середня кнопка',
  'menu.sleep': 'Приспати',
  'menu.sleep.hint': 'процес зупиниться',
  'menu.clear': 'Очистити історію',
  'menu.clear.hint': 'екран залишиться, процес працюватиме далі',

  'history.title': 'Історія агент-сесій',
  'history.aria': 'Історія агент-сесій: {count}',
  'history.caption': 'Минулі запуски в цій сесії',
  'history.runId': 'id: {id}',
  'history.noId': 'id невідомий — відкриється вибір сесії агента',

  restart: 'Перезапустити процес',
  'restart.aria': 'Перезапустити процес вкладки',
  restarting: 'Перезапускаю…',

  'sleep.card': '«{title}» спить.',
  'sleep.cardAgent': '«{title}» спить — процес зупинено, історію бесіди збережено.',
  'sleep.wake': 'Розбудити',
  'sleep.frozen': 'Спить: останній екран «{title}». Процес зупинено.',
  'sleep.frozenAgent': 'Спить: останній екран «{title}». Процес зупинено, історію бесіди збережено.',

  silent:
    'Агент нічого не повідомляє: дізнатися, що він закінчив, не буде звідки, і сповіщення не надійде. Його хуки не працюють — перевірте аргументи агента (--bare) і власні налаштування CLI.',

  empty: 'Терміналів немає — додайте агента або shell кнопками вище.',

  'exit.code': '— процес завершено (код {code}) —',
  'exit.notStarted': '— процес не запущено —',

  'search.placeholder': 'Пошук у терміналі',
  'search.prev': 'Назад (Shift+Enter)',
  'search.next': 'Уперед (Enter)',
  'search.copyAll': 'Скопіювати весь вивід вкладки (Ctrl+Shift+A)',
  'search.copyAllLabel': '⧉ усе',
  'search.close': 'Закрити пошук (Esc)',

  'link.open': 'Відкрити {path} у редакторі',
  'link.openAt': 'Відкрити {path} у редакторі, рядок {line}',
  'link.gone': 'Файла більше немає',
  'link.notAFile': 'Це не файл — у редакторі відкриваються лише файли',
  'link.failed': 'Не вдалося відкрити файл',

  'menu.copy': 'Копіювати',
  'menu.copyAll': 'Копіювати весь вивід',
  'menu.paste': 'Вставити',
  'menu.find': 'Пошук',
  'run.agentGone': 'агент цього запуску більше не налаштований',
  'tab.asleep': 'вкладка спить — розбудіть її та повторіть',
  'notify.fallbackTitle': 'Термінал',
  'notify.waiting': '{project}: агент чекає на вас',
}
