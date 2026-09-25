import type { ProjectsArea } from '../en/projects'

export const projects: ProjectsArea = {
  sessionCount: {
    zero: 'без сесій',
    one: '{count} сесія',
    few: '{count} сесії',
    many: '{count} сесій',
    // fractions only, and they take the same form as 2–4: «1,5 сесії»
    other: '{count} сесії',
  },
  'empty.hint': 'Відкрийте теку з проєктом або клонуйте репозиторій із GitHub.',
  'empty.open': 'Відкрити теку…',
  'empty.clone': 'Клонувати репозиторій…',
  'tab.aria': 'Проєкт {name}',
  'tab.aria.status': 'Проєкт {name} — {status}',
  'tab.title': '{path} · середня кнопка миші — закрити',
  'tab.title.git': '{path} · git-репозиторій · середня кнопка миші — закрити',
  'rename.label': 'Назва проєкту',
  'menu.rename': 'Перейменувати',
  'menu.rename.hint': 'подвійний клік',
  close: 'Закрити проєкт',
  'close.aria': 'Закрити проєкт {name}',
  'menu.close.hint': 'середня кнопка',
  'closed.title': '{path} · закрито {time} · права кнопка — забути',
  'closed.forget': 'Забути «{name}»',
  'closed.forget.hint': 'сесії не повернуться',
  add: 'Додати проєкт',
  settings: 'Налаштування агентів',
  'pick.title': 'Відкрити проєкт',
}
