import type { EditorArea } from '../en/editor'

export const editor: EditorArea = {
  loading: 'Открываю…',
  'open.failed': 'не удалось открыть файл',
  'save.failed': 'не удалось сохранить файл',
  'reload.failed': 'не удалось перечитать файл',
  'conflict.unsaved': '{file}: файл изменился на диске — несохранённые правки не записаны',
  'conflict.cancelled': '{file}: файл изменился на диске — сохранение отменено',

  dirty: 'Не сохранено',
  'status.conflict': 'файл изменился на диске',
  'status.saving': 'сохраняю…',
  'status.unsaved': 'не сохранено — Ctrl+S',
  'status.saved': 'сохранено',
  'status.autoSave': 'автосохранение',

  send: '→ агенту',
  'send.title': 'Вставить ссылку на файл в активную вкладку агента',
  overwrite: 'Перезаписать',
  'overwrite.title': 'Записать наш вариант поверх того, что на диске',
  reload: 'Перечитать',
  'reload.title': 'Перечитать файл с диска: наши правки будут потеряны',
  save: 'Сохранить',
  'save.title': 'Сохранить (Ctrl+S)',
  close: 'Закрыть (Esc)',
  'close.editor.aria': 'Закрыть редактор (Esc)',

  'diff.wrap': 'Перенос строк',
  'diff.wrap.on': '⤶ вкл',
  'diff.wrap.off': '⤶ выкл',
  'diff.external': 'Открыть файл во внешнем редакторе',
  'diff.close.aria': 'Закрыть дифф (Esc)',
  'diff.empty': 'Нет данных для показа',
}
