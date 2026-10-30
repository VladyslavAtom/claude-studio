import type { WorktreesArea } from '../en/worktrees'

export const worktrees: WorktreesArea = {
  'row.mainFolder': 'основна тека ({branch})',
  'row.mainFolderNoBranch': 'основна тека',
  'row.more': { one: 'ще {count}', few: 'ще {count}', many: 'ще {count}', other: 'ще {count}' },
  'row.title': '{path}\nЗгадується в бесідах цієї сесії',

  'switch.aria': 'Worktree, який показують панель змін і дерево файлів',
  'switch.main': 'основна тека',

  open: 'Worktree проєкту',
  title: 'Worktree: {project}',
  hint: 'Усі worktree репозиторіїв проєкту, разом із тими, що агенти створили самі.',
  loading: 'Читаю worktree…',
  empty: 'Крім основних тек, worktree немає.',
  refresh: 'Оновити',

  'item.main': 'основна тека',
  'item.detached': 'detached HEAD',
  'item.locked': 'заблоковано',
  'item.statusLoading': 'перевіряю…',
  'item.statusUnknown': 'стан невідомий',
  'item.clean': 'без змін',
  'item.changed': {
    one: '{count} змінений файл',
    few: '{count} змінені файли',
    many: '{count} змінених файлів',
    other: '{count} зміненого файлу',
  },
  'item.unpushed': {
    one: '{count} commit без push',
    few: '{count} commit без push',
    many: '{count} commit без push',
    other: '{count} commit без push',
  },
  'item.merged': 'merge зроблено',
  'item.notMerged': 'merge не зроблено',
  'item.live': 'зайнятий',
  'item.live.title': 'Тут працює агент або термінал, або тут живе сесія: такий worktree не видаляється.',
  'item.owners': 'сесії: {names}',

  'action.openSession': 'Відкрити сесію тут',
  'action.shell': 'Термінал тут',
  'action.shell.noSession': 'Спершу виберіть сесію: термінал відкриється її вкладкою.',
  'action.remove': 'Видалити…',

  'bulk.button': 'Видалити після merge ({count})',
  'bulk.title': 'Видалити worktree після merge',
  'bulk.hint':
    'У кожному немає змін, усе надіслано (push) і merge зроблено. Тека видаляється разом із локальною гілкою (git worktree remove, git branch -d); гілка, яку git відмовився видалити, лишається.',
  'bulk.confirm': 'Видалити {count}',
  'bulk.done': {
    one: 'Видалено {count} worktree',
    few: 'Видалено {count} worktree',
    many: 'Видалено {count} worktree',
    other: 'Видалено {count} worktree',
  },
  busy: 'Видаляю worktree…',

  'remove.title': 'Видалити worktree {name}',
  'remove.safe': 'Нічого не загубиться: змін немає, усе надіслано, merge зроблено.',
  'remove.loses': 'Буде втрачено:',
  'remove.notMerged': 'merge гілки {branch} не зроблено',
  'remove.what': 'Видаляються тека та її локальна гілка: ',
  'remove.confirm': 'Видалити',

  'error.live': 'Не видалено: у ньому працює агент або термінал, або там живе сесія.',
  'error.notSafe':
    'Не видалено: є зміни, commit без push або merge не зроблено. Видаліть його окремо, після попередження.',
  'error.notRemovable': 'Це не worktree цього репозиторію, який можна видалити.',
}
