import type { EditorArea } from '../en/editor'

export const editor: EditorArea = {
  loading: 'Відкриваю…',
  'open.failed': 'не вдалося відкрити файл',
  'save.failed': 'не вдалося зберегти файл',
  'reload.failed': 'не вдалося перечитати файл',
  'conflict.unsaved': '{file}: файл змінився на диску — незбережені правки не записано',
  'conflict.cancelled': '{file}: файл змінився на диску — збереження скасовано',

  dirty: 'Не збережено',
  'status.conflict': 'файл змінився на диску',
  'status.saving': 'зберігаю…',
  'status.unsaved': 'не збережено — Ctrl+S',
  'status.saved': 'збережено',
  'status.autoSave': 'автозбереження',

  send: '→ агентові',
  'send.title': 'Вставити посилання на файл в активну вкладку агента',
  overwrite: 'Перезаписати',
  'overwrite.title': 'Записати наш варіант поверх того, що на диску',
  reload: 'Перечитати',
  'reload.title': 'Перечитати файл з диска: наші правки буде втрачено',
  save: 'Зберегти',
  'save.title': 'Зберегти (Ctrl+S)',
  close: 'Закрити (Esc)',
  'close.editor.aria': 'Закрити редактор (Esc)',

  'diff.wrap': 'Перенесення рядків',
  'diff.wrap.on': '⤶ увімк',
  'diff.wrap.off': '⤶ вимк',
  'diff.external': 'Відкрити файл у зовнішньому редакторі',
  'diff.close.aria': 'Закрити дифф (Esc)',
  'diff.empty': 'Немає даних для показу',
}
