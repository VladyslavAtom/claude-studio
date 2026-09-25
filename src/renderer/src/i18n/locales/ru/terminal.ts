import type { TerminalArea } from '../en/terminal'

export const terminal: TerminalArea = {
  'status.running': 'работает',
  'status.waiting': 'ждёт вас',
  'status.idle': 'простаивает',
  'status.asleep': 'спит — клик разбудит и продолжит с того же места',
  'status.dead': 'процесс завершён',

  'tabs.aria': 'Вкладки сессии',
  'tab.agent': 'Агент',
  'tab.aria': '{title} — {status}',
  'tab.hint': '{status} · средняя кнопка мыши — закрыть',
  'tab.hintAgent': '{status} · {command} · средняя кнопка мыши — закрыть',
  'tab.name.aria': 'Имя вкладки',
  'tab.close': 'Закрыть терминал',
  'tab.close.aria': 'Закрыть вкладку «{title}»',

  'add.title': 'Новая вкладка: {what} (Ctrl+T)',
  'add.other': 'Другой агент',
  'add.other.aria': 'Выбрать агента для новой вкладки',
  'add.menu.aria': 'Чем открыть новую вкладку',

  'menu.rename': 'Переименовать',
  'menu.rename.hint': 'двойной клик',
  'menu.close': 'Закрыть вкладку',
  'menu.close.hint': 'средняя кнопка',
  'menu.sleep': 'Усыпить',
  'menu.sleep.hint': 'процесс остановится',
  'menu.clear': 'Очистить историю',
  'menu.clear.hint': 'экран останется, процесс продолжит работу',

  'history.title': 'История агент-сессий',
  'history.aria': 'История агент-сессий: {count}',
  'history.caption': 'Прошлые запуски в этой сессии',
  'history.runId': 'id: {id}',
  'history.noId': 'id неизвестен — откроется пикер агента',

  restart: 'Перезапустить процесс',
  'restart.aria': 'Перезапустить процесс вкладки',
  restarting: 'Перезапускаю…',

  'sleep.card': '«{title}» спит.',
  'sleep.cardAgent': '«{title}» спит — процесс остановлен, история беседы сохранена.',
  'sleep.wake': 'Разбудить',
  'sleep.frozen': 'Спит: последний экран «{title}». Процесс остановлен.',
  'sleep.frozenAgent': 'Спит: последний экран «{title}». Процесс остановлен, история беседы сохранена.',

  silent:
    'Агент ничего не сообщает: узнать, что он закончил, будет неоткуда, и уведомления не придёт. Его хуки не работают — проверьте аргументы агента (--bare) и собственные настройки CLI.',

  empty: 'Терминалов нет — добавьте агента или shell кнопками выше.',

  'exit.code': '— процесс завершён (код {code}) —',
  'exit.notStarted': '— процесс не запущен —',

  'search.placeholder': 'Поиск в терминале',
  'search.prev': 'Назад (Shift+Enter)',
  'search.next': 'Вперёд (Enter)',
  'search.copyAll': 'Скопировать весь вывод вкладки (Ctrl+Shift+A)',
  'search.copyAllLabel': '⧉ всё',
  'search.close': 'Закрыть поиск (Esc)',

  'link.open': 'Открыть {path} в редакторе',
  'link.openAt': 'Открыть {path} в редакторе, строка {line}',
  'link.gone': 'Файла больше нет',
  'link.notAFile': 'Это не файл — в редакторе открываются только файлы',
  'link.failed': 'Не удалось открыть файл',

  'menu.copy': 'Копировать',
  'menu.copyAll': 'Копировать весь вывод',
  'menu.paste': 'Вставить',
  'menu.find': 'Поиск',
  'run.agentGone': 'агент этого запуска больше не настроен',
  'tab.asleep': 'вкладка спит — разбудите её и повторите',
  'notify.fallbackTitle': 'Терминал',
  'notify.waiting': '{project}: агент ждёт вас',
}
