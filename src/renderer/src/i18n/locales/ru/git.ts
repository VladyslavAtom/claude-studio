import type { GitArea } from '../en/git'

export const git: GitArea = {
  // --- действия, общие для меню проекта и меню ветки сессии ---
  pull: 'Pull — обновить {what}',
  'what.project': 'проект',
  'what.branch': 'ветку',
  'pull.hint.ask': 'спросит способ',
  push: 'Push текущей ветки',
  'push.hint.detached': 'HEAD отделён',
  'push.detachedHead': 'HEAD отделён от ветки — переключитесь на ветку или создайте новую',
  createPr: 'Создать pull request',
  mergeInto: 'Merge «{branch}» в текущую',
  rebaseOnto: 'Rebase текущей на «{branch}»',
  'rebase.hint.upToDate': 'актуально',
  rename: 'Переименовать…',

  // --- меню ветки сессии ---
  branchLabel: 'Ветка {branch}',
  'branchMenu.aria': 'Ветка {branch} — действия',
  'title.base': {
    one: 'Ответвлена от {ref} · там {count} новый коммит, которого здесь нет',
    few: 'Ответвлена от {ref} · там {count} новых коммита, которых здесь нет',
    many: 'Ответвлена от {ref} · там {count} новых коммитов, которых здесь нет',
    other: 'Ответвлена от {ref} · там {count} новых коммитов, которых здесь нет',
  },
  'title.baseCurrent': 'Ответвлена от {ref} · база не ушла вперёд',
  'title.folder': 'Папка: {path}',
  'scope.showProject': 'Показать общий каталог проекта',
  'scope.showSession': 'Вернуться к папке сессии',

  // --- меню проекта: список веток и поиск ---
  'menu.title': 'Git: {project}',
  'menu.aria': 'Git: {project}, ветка {branch}',
  search: 'Поиск веток и действий',
  'newBranch.named': 'Новая ветка «{name}»',
  'newBranch.prompt': 'Новая ветка…',
  'newBranch.hint': 'от текущей',
  'newBranch.needName': 'впишите имя новой ветки в поле поиска',
  'caption.recent': 'Недавние',
  'caption.all': 'Все ветки',
  noBranches: 'Веток не найдено',
  branchActions: 'Действия с веткой',
  'branchActions.aria': 'Действия с веткой {branch}',
  checkout: 'Переключиться на «{branch}»',
  'checkout.current': '«{branch}» — текущая ветка',
  newWorktreeSession: 'Новая сессия в worktree от «{branch}»',
  newBranchFrom: 'Новая ветка от «{branch}»',
  deleteBranch: 'Удалить ветку',
  'delete.title': 'Удалить ветку «{branch}»?',
  'delete.hint': 'Действие нельзя отменить обычным способом.',
  'delete.unmerged':
    'Обычное удаление отказало: в «{branch}» есть коммиты, которых нет в текущей ветке. Принудительное ' +
    'удаление (git branch -D) потеряет их безвозвратно.',
  'delete.confirm': 'Удалить',
  'delete.force': 'Удалить принудительно',

  // --- выбор способа pull, общий для обоих меню (PullChoiceModal) ---
  'pullChoice.title': 'Как забрать чужие коммиты в {what}?',
  'pullChoice.what.project': 'проект «{name}»',
  'pullChoice.what.branch': 'ветку «{branch}»',
  'pullChoice.rebase': 'Rebase — перенести мои коммиты наверх',
  'pullChoice.rebase.hint':
    'История остаётся линейной, лишнего коммита слияния не будет. Мои коммиты получат новые идентификаторы — ' +
    'если ветка уже отправлена, push потребует принудительного.',
  'pullChoice.merge': 'Merge — коммит слияния',
  'pullChoice.merge.hint':
    'Ничего не переписывается, история сохраняется как есть. В журнале появится отдельный коммит слияния.',
  'pullChoice.remember': 'Запомнить выбор — потом можно сменить в настройках',

  // --- переименование, общее для обоих меню (RenameBranchModal) ---
  'rename.title': 'Переименовать ветку «{branch}»',
  'rename.newName': 'Новое имя',
  'rename.submit': 'Переименовать',

  // --- что показывает строка состояния, пока действие идёт и когда закончилось ---
  'run.progress': '{label}…',
  'run.done': '{label}: готово',
  'run.failed': '{label}: не удалось',
  'run.crashed': '{label}: {error}',
  'run.pull': 'Pull',
  'run.pullFrom': 'Pull из «{ref}»',
  'run.createPr': 'Создаю pull request',
  'run.mergeBase': 'Merge базы',
  'run.rebaseBase': 'Rebase на базу',
  'run.rename': 'Переименование',
  'run.checkout': 'Переключаюсь на {branch}',
  'run.branchFrom': 'Ветка от {branch}',
  'run.merge': 'Merge {branch}',
  'run.rebase': 'Rebase на {branch}',
  'run.createBranch': 'Создаю {name}',
  'run.deleteBranch': 'Удаление ветки «{branch}»',
  'run.branchDeleted': 'Ветка «{branch}» удалена',

  // --- коды главного процесса: сам запуск команды ---
  'error.outputTooLarge':
    'вывод «{command}» превысил {limitMb} МБ — выберите меньше файлов или откройте дифф по одному',
  'error.timeout': '«{command}» не ответила за {seconds} с и была прервана',
  'error.notFound': '«{command}» не найдена: проверьте, установлен ли git и виден ли он в PATH',
  'error.spawnFailed': '«{command}» не запустилась ({reason})',

  // --- коммит, откат, разрешение конфликтов ---
  'error.noFilesSelected': 'не выбрано ни одного файла',
  'error.commitEmptyMessage': 'пустое сообщение коммита',
  'error.commitAlreadyCommitted':
    'нечего коммитить: выбранные файлы не отличаются от последнего коммита — они уже закоммичены, список вот-вот обновится',
  'error.commitNothingToCommit': 'нечего коммитить: рабочее дерево чистое',
  // число здесь не согласуется со словом («пропущено … : 5»), поэтому все формы совпадают
  'note.commitSkipped': {
    one: ' · пропущено уже закоммиченных: {count}',
    few: ' · пропущено уже закоммиченных: {count}',
    many: ' · пропущено уже закоммиченных: {count}',
    other: ' · пропущено уже закоммиченных: {count}',
  },

  // --- незавершённая операция: остановка на конфликте — нормальный исход, а не отказ ---
  'error.noOperationInProgress': 'нет незавершённой операции',
  'note.conflict.merge': {
    one: 'Merge остановлен на конфликте в {count} файле — решите его в панели изменений',
    few: 'Merge остановлен на конфликте в {count} файлах — решите их в панели изменений',
    many: 'Merge остановлен на конфликте в {count} файлах — решите их в панели изменений',
    other: 'Merge остановлен на конфликте в {count} файлах — решите их в панели изменений',
  },
  'note.conflict.mergeRef': {
    one: 'Merge «{ref}» остановлен на конфликте в {count} файле — решите его в панели изменений',
    few: 'Merge «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
    many: 'Merge «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
    other: 'Merge «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
  },
  'note.conflict.rebase': {
    one: 'Rebase остановлен на конфликте в {count} файле — решите его в панели изменений',
    few: 'Rebase остановлен на конфликте в {count} файлах — решите их в панели изменений',
    many: 'Rebase остановлен на конфликте в {count} файлах — решите их в панели изменений',
    other: 'Rebase остановлен на конфликте в {count} файлах — решите их в панели изменений',
  },
  'note.conflict.rebaseRef': {
    one: 'Rebase на «{ref}» остановлен на конфликте в {count} файле — решите его в панели изменений',
    few: 'Rebase на «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
    many: 'Rebase на «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
    other: 'Rebase на «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
  },
  'note.conflict.pull': {
    one: 'Pull остановлен на конфликте в {count} файле — решите его в панели изменений',
    few: 'Pull остановлен на конфликте в {count} файлах — решите их в панели изменений',
    many: 'Pull остановлен на конфликте в {count} файлах — решите их в панели изменений',
    other: 'Pull остановлен на конфликте в {count} файлах — решите их в панели изменений',
  },
  'note.conflict.pullRef': {
    one: 'Pull из «{ref}» остановлен на конфликте в {count} файле — решите его в панели изменений',
    few: 'Pull из «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
    many: 'Pull из «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
    other: 'Pull из «{ref}» остановлен на конфликте в {count} файлах — решите их в панели изменений',
  },

  // --- ветки и worktree ---
  'error.branchUsedByWorktree':
    'ветка «{branch}» занята worktree {path} — сначала удалите его или переключите там ветку',
  'error.worktreeBranchBusy':
    'ветка «{branch}» уже занята другим worktree — выберите другое имя ветки или закройте ту сессию',
  'error.worktreeRemoveFailed.both':
    'не удалось удалить worktree (запись о нём осталась в репозитории, каталог остался на диске)',
  'error.worktreeRemoveFailed.record': 'не удалось удалить worktree (запись о нём осталась в репозитории)',
  'error.worktreeRemoveFailed.dir': 'не удалось удалить worktree (каталог остался на диске)',
  'warning.worktreeRemovedBranchKept': 'worktree удалён, но ветка осталась',

  // --- сервер ---
  'error.noUpstream': 'у ветки нет upstream — сначала push, он и заведёт её на сервере',
  'error.prCreateNoUrl': 'gh pr create failed',

  // --- адрес для clone ---
  'error.cloneUrlEmpty': 'укажите адрес репозитория',
  'error.cloneUrlLeadingDash': 'адрес репозитория не может начинаться с «-»',
  'error.cloneUrlHelper': 'такой адрес не поддерживается: укажите https://…, ssh://…, git@host:path или путь на диске',
  'error.cloneUrlScheme': 'протокол «{scheme}» не поддерживается: укажите https, http, ssh или git',
  'error.cloneUrlUnrecognised':
    'непонятный адрес: укажите https://…, ssh://…, git@host:path или абсолютный путь на диске',

  // --- чтение и запись файлов ---
  'error.pathOutsideRoots': 'путь вне разрешённых каталогов',
  'error.fileTooLarge': 'файл больше {limitMb} МБ ({sizeKb} КБ)',
  'error.fileBinary': 'бинарный файл',

  // --- черновик сообщения коммита ---
  'error.draftNoChanges': 'нет изменений для описания: выбранные файлы совпадают с HEAD',
  'error.draftNoChangesRef': 'нет изменений для описания: выбранные файлы совпадают с HEAD и {ref}',
  'error.draftEmptyAnswer': 'пустой ответ',
  'error.serviceNoAnswer': 'служебная сессия не ответила',

  'error.withDetail': '{message}: {detail}',
}
