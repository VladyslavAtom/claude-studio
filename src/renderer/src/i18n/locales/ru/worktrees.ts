import type { WorktreesArea } from '../en/worktrees'

export const worktrees: WorktreesArea = {
  'row.mainFolder': 'основная папка ({branch})',
  'row.mainFolderNoBranch': 'основная папка',
  'row.more': { one: 'ещё {count}', few: 'ещё {count}', many: 'ещё {count}', other: 'ещё {count}' },
  'row.title': '{path}\nУпоминается в беседах этой сессии',

  'switch.aria': 'Worktree, который показывают панель изменений и дерево файлов',
  'switch.main': 'основная папка',

  open: 'Worktree проекта',
  title: 'Worktree: {project}',
  hint: 'Все worktree репозиториев проекта, включая те, что агенты создали сами.',
  loading: 'Читаю worktree…',
  empty: 'Кроме основных папок, worktree нет.',
  refresh: 'Обновить',

  'item.main': 'основная папка',
  'item.detached': 'detached HEAD',
  'item.locked': 'заблокирован',
  'item.statusLoading': 'проверяю…',
  'item.statusUnknown': 'состояние неизвестно',
  'item.clean': 'без изменений',
  'item.changed': {
    one: '{count} изменённый файл',
    few: '{count} изменённых файла',
    many: '{count} изменённых файлов',
    other: '{count} изменённого файла',
  },
  'item.unpushed': {
    one: '{count} commit без push',
    few: '{count} commit без push',
    many: '{count} commit без push',
    other: '{count} commit без push',
  },
  'item.merged': 'merge сделан',
  'item.notMerged': 'merge не сделан',
  'item.live': 'занят',
  'item.live.title': 'Здесь работает агент или терминал, или здесь живёт сессия: такой worktree не удаляется.',
  'item.owners': 'сессии: {names}',

  'action.openSession': 'Открыть сессию здесь',
  'action.shell': 'Терминал здесь',
  'action.shell.noSession': 'Сначала выберите сессию: терминал откроется её вкладкой.',
  'action.remove': 'Удалить…',

  'bulk.button': 'Удалить после merge ({count})',
  'bulk.title': 'Удалить worktree после merge',
  'bulk.hint':
    'В каждом нет изменений, всё отправлено (push) и merge сделан. Папка удаляется вместе с локальной веткой (git worktree remove, git branch -d); ветка, которую git удалить отказался, остаётся.',
  'bulk.confirm': 'Удалить {count}',
  'bulk.done': {
    one: 'Удалён {count} worktree',
    few: 'Удалено {count} worktree',
    many: 'Удалено {count} worktree',
    other: 'Удалено {count} worktree',
  },
  busy: 'Удаляю worktree…',

  'remove.title': 'Удалить worktree {name}',
  'remove.safe': 'Ничего не потеряется: изменений нет, всё отправлено, merge сделан.',
  'remove.loses': 'Будет потеряно:',
  'remove.notMerged': 'merge ветки {branch} не сделан',
  'remove.what': 'Удаляются папка и её локальная ветка: ',
  'remove.confirm': 'Удалить',

  'error.live': 'Не удалён: в нём работает агент или терминал, или там живёт сессия.',
  'error.notSafe':
    'Не удалён: есть изменения, commit без push или merge не сделан. Удалите его отдельно, после предупреждения.',
  'error.notRemovable': 'Это не worktree этого репозитория, который можно удалить.',
}
