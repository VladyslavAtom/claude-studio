import type { ProjectsArea } from '../en/projects'

export const projects: ProjectsArea = {
  sessionCount: {
    zero: 'без сессий',
    one: '{count} сессия',
    few: '{count} сессии',
    many: '{count} сессий',
    // fractions only, and they take the same form as 2–4: «1,5 сессии»
    other: '{count} сессии',
  },
  'empty.hint': 'Откройте папку с проектом или клонируйте репозиторий с GitHub.',
  'empty.open': 'Открыть папку…',
  'empty.clone': 'Клонировать репозиторий…',
  'tab.aria': 'Проект {name}',
  'tab.aria.status': 'Проект {name} — {status}',
  'tab.title': '{path} · средняя кнопка мыши — закрыть',
  'tab.title.git': '{path} · git-репозиторий · средняя кнопка мыши — закрыть',
  'rename.label': 'Имя проекта',
  'menu.rename': 'Переименовать',
  'menu.rename.hint': 'двойной клик',
  close: 'Закрыть проект',
  'close.aria': 'Закрыть проект {name}',
  'menu.close.hint': 'средняя кнопка',
  'closed.title': '{path} · закрыт {time} · правая кнопка — забыть',
  'closed.forget': 'Забыть «{name}»',
  'closed.forget.hint': 'сессии не вернутся',
  add: 'Добавить проект',
  settings: 'Настройки агентов',
  'pick.title': 'Открыть проект',
}
