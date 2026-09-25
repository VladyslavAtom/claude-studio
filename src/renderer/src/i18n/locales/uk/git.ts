import type { GitArea } from '../en/git'

export const git: GitArea = {
  // --- дії, спільні для меню проєкту та меню гілки сесії ---
  pull: 'Pull — оновити {what}',
  'what.project': 'проєкт',
  'what.branch': 'гілку',
  'pull.hint.ask': 'запитає спосіб',
  push: 'Push поточної гілки',
  'push.hint.detached': 'HEAD відокремлений',
  'push.detachedHead': 'HEAD відокремлений від гілки — перейдіть на гілку або створіть нову',
  createPr: 'Створити pull request',
  mergeInto: 'Merge «{branch}» у поточну',
  rebaseOnto: 'Rebase поточної на «{branch}»',
  'rebase.hint.upToDate': 'актуально',
  rename: 'Перейменувати…',

  // --- меню гілки сесії ---
  branchLabel: 'Гілка {branch}',
  'branchMenu.aria': 'Гілка {branch} — дії',
  'title.base': {
    one: 'Відгалужена від {ref} · там {count} новий коміт, якого тут немає',
    few: 'Відгалужена від {ref} · там {count} нові коміти, яких тут немає',
    many: 'Відгалужена від {ref} · там {count} нових комітів, яких тут немає',
    other: 'Відгалужена від {ref} · там {count} нових комітів, яких тут немає',
  },
  'title.baseCurrent': 'Відгалужена від {ref} · база не пішла вперед',
  'title.folder': 'Тека: {path}',
  'scope.showProject': 'Показати спільний каталог проєкту',
  'scope.showSession': 'Повернутися до теки сесії',

  // --- меню проєкту: список гілок і пошук ---
  'menu.title': 'Git: {project}',
  'menu.aria': 'Git: {project}, гілка {branch}',
  search: 'Пошук гілок і дій',
  'newBranch.named': 'Нова гілка «{name}»',
  'newBranch.prompt': 'Нова гілка…',
  'newBranch.hint': 'від поточної',
  'newBranch.needName': 'впишіть назву нової гілки в поле пошуку',
  'caption.recent': 'Нещодавні',
  'caption.all': 'Усі гілки',
  noBranches: 'Гілок не знайдено',
  branchActions: 'Дії з гілкою',
  'branchActions.aria': 'Дії з гілкою {branch}',
  checkout: 'Перейти на «{branch}»',
  'checkout.current': '«{branch}» — поточна гілка',
  newWorktreeSession: 'Нова сесія у worktree від «{branch}»',
  newBranchFrom: 'Нова гілка від «{branch}»',
  deleteBranch: 'Видалити гілку',
  'delete.title': 'Видалити гілку «{branch}»?',
  'delete.hint': 'Дію не можна скасувати звичайним способом.',
  'delete.unmerged':
    'Звичайне видалення відхилено: у «{branch}» є коміти, яких немає в поточній гілці. Примусове ' +
    'видалення (git branch -D) втратить їх безповоротно.',
  'delete.confirm': 'Видалити',
  'delete.force': 'Видалити примусово',

  // --- вибір способу pull, спільний для обох меню (PullChoiceModal) ---
  'pullChoice.title': 'Як забрати чужі коміти в {what}?',
  'pullChoice.what.project': 'проєкт «{name}»',
  'pullChoice.what.branch': 'гілку «{branch}»',
  'pullChoice.rebase': 'Rebase — перенести мої коміти нагору',
  'pullChoice.rebase.hint':
    'Історія лишається лінійною, зайвого коміту злиття не буде. Мої коміти отримають нові ідентифікатори — ' +
    'якщо гілку вже відправлено, push вимагатиме примусового.',
  'pullChoice.merge': 'Merge — коміт злиття',
  'pullChoice.merge.hint':
    'Нічого не переписується, історія зберігається як є. У журналі з’явиться окремий коміт злиття.',
  'pullChoice.remember': 'Запам’ятати вибір — потім можна змінити в налаштуваннях',

  // --- перейменування, спільне для обох меню (RenameBranchModal) ---
  'rename.title': 'Перейменувати гілку «{branch}»',
  'rename.newName': 'Нова назва',
  'rename.submit': 'Перейменувати',

  // --- що показує рядок стану, поки дія триває і коли вона скінчилася ---
  'run.progress': '{label}…',
  'run.done': '{label}: готово',
  'run.failed': '{label}: не вдалося',
  'run.crashed': '{label}: {error}',
  'run.pull': 'Pull',
  'run.pullFrom': 'Pull із «{ref}»',
  'run.createPr': 'Створюю pull request',
  'run.mergeBase': 'Merge бази',
  'run.rebaseBase': 'Rebase на базу',
  'run.rename': 'Перейменування',
  'run.checkout': 'Переходжу на {branch}',
  'run.branchFrom': 'Гілка від {branch}',
  'run.merge': 'Merge {branch}',
  'run.rebase': 'Rebase на {branch}',
  'run.createBranch': 'Створюю {name}',
  'run.deleteBranch': 'Видалення гілки «{branch}»',
  'run.branchDeleted': 'Гілку «{branch}» видалено',

  // --- коди головного процесу: сам запуск команди ---
  'error.outputTooLarge':
    'вивід «{command}» перевищив {limitMb} МБ — виберіть менше файлів або відкривайте дифф по одному',
  'error.timeout': '«{command}» не відповіла за {seconds} с і була перервана',
  'error.notFound': '«{command}» не знайдено: перевірте, чи встановлено git і чи видно його в PATH',
  'error.spawnFailed': '«{command}» не запустилася ({reason})',

  // --- коміт, відкат, розвʼязання конфліктів ---
  'error.noFilesSelected': 'не вибрано жодного файлу',
  'error.commitEmptyMessage': 'порожнє повідомлення коміту',
  'error.commitAlreadyCommitted':
    'нічого комітити: вибрані файли не відрізняються від останнього коміту — вони вже закомічені, список ось-ось оновиться',
  'error.commitNothingToCommit': 'нічого комітити: робоче дерево чисте',
  // число тут не узгоджується зі словом («пропущено … : 5»), тому всі форми однакові
  'note.commitSkipped': {
    one: ' · пропущено вже закомічених: {count}',
    few: ' · пропущено вже закомічених: {count}',
    many: ' · пропущено вже закомічених: {count}',
    other: ' · пропущено вже закомічених: {count}',
  },

  // --- незавершена операція: зупинка на конфлікті — звичайний результат, а не відмова ---
  'error.noOperationInProgress': 'немає незавершеної операції',
  'note.conflict.merge': {
    one: 'Merge зупинено на конфлікті в {count} файлі — розвʼяжіть його в панелі змін',
    few: 'Merge зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    many: 'Merge зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    other: 'Merge зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
  },
  'note.conflict.mergeRef': {
    one: 'Merge «{ref}» зупинено на конфлікті в {count} файлі — розвʼяжіть його в панелі змін',
    few: 'Merge «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    many: 'Merge «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    other: 'Merge «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
  },
  'note.conflict.rebase': {
    one: 'Rebase зупинено на конфлікті в {count} файлі — розвʼяжіть його в панелі змін',
    few: 'Rebase зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    many: 'Rebase зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    other: 'Rebase зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
  },
  'note.conflict.rebaseRef': {
    one: 'Rebase на «{ref}» зупинено на конфлікті в {count} файлі — розвʼяжіть його в панелі змін',
    few: 'Rebase на «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    many: 'Rebase на «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    other: 'Rebase на «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
  },
  'note.conflict.pull': {
    one: 'Pull зупинено на конфлікті в {count} файлі — розвʼяжіть його в панелі змін',
    few: 'Pull зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    many: 'Pull зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    other: 'Pull зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
  },
  'note.conflict.pullRef': {
    one: 'Pull із «{ref}» зупинено на конфлікті в {count} файлі — розвʼяжіть його в панелі змін',
    few: 'Pull із «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    many: 'Pull із «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
    other: 'Pull із «{ref}» зупинено на конфлікті у {count} файлах — розвʼяжіть їх у панелі змін',
  },

  // --- гілки та worktree ---
  'error.branchUsedByWorktree':
    'гілку «{branch}» зайнято worktree {path} — спершу видаліть його або перемкніть там гілку',
  'error.worktreeBranchBusy':
    'гілку «{branch}» уже зайнято іншим worktree — виберіть іншу назву гілки або закрийте ту сесію',
  'error.worktreeRemoveFailed.both':
    'не вдалося видалити worktree (запис про нього лишився в репозиторії, каталог лишився на диску)',
  'error.worktreeRemoveFailed.record': 'не вдалося видалити worktree (запис про нього лишився в репозиторії)',
  'error.worktreeRemoveFailed.dir': 'не вдалося видалити worktree (каталог лишився на диску)',
  'warning.worktreeRemovedBranchKept': 'worktree видалено, але гілка лишилася',

  // --- сервер ---
  'error.noUpstream': 'у гілки немає upstream — спершу push, він і заведе її на сервері',
  'error.prCreateNoUrl': 'gh pr create failed',

  // --- адреса для clone ---
  'error.cloneUrlEmpty': 'вкажіть адресу репозиторію',
  'error.cloneUrlLeadingDash': 'адреса репозиторію не може починатися з «-»',
  'error.cloneUrlHelper': 'така адреса не підтримується: вкажіть https://…, ssh://…, git@host:path або шлях на диску',
  'error.cloneUrlScheme': 'протокол «{scheme}» не підтримується: вкажіть https, http, ssh або git',
  'error.cloneUrlUnrecognised':
    'незрозуміла адреса: вкажіть https://…, ssh://…, git@host:path або абсолютний шлях на диску',

  // --- читання і запис файлів ---
  'error.pathOutsideRoots': 'шлях поза дозволеними каталогами',
  'error.fileTooLarge': 'файл більший за {limitMb} МБ ({sizeKb} КБ)',
  'error.fileBinary': 'бінарний файл',

  // --- чернетка повідомлення коміту ---
  'error.draftNoChanges': 'немає змін для опису: вибрані файли збігаються з HEAD',
  'error.draftNoChangesRef': 'немає змін для опису: вибрані файли збігаються з HEAD і {ref}',
  'error.draftEmptyAnswer': 'порожня відповідь',
  'error.serviceNoAnswer': 'службова сесія не відповіла',

  'error.withDetail': '{message}: {detail}',
}
