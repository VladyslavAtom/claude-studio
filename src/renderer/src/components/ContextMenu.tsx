import type { JSX } from 'react'
import { Menu, MenuItem as Item } from '../ui/Menu'
import { useT } from '../i18n'
import { useMenu } from '../ui/useMenu'

export interface MenuItem {
  label: string
  hint?: string
  danger?: boolean
  onPick: () => void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/**
 * Right-click menu. Shared by project, session and terminal tabs: the items differ, the
 * behaviour does not, and there is no reason for it to drift apart.
 */
export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const t = useT()
  // the menu only exists while it is open, so it is always the open one
  const menu = useMenu(true, onClose)

  return (
    <>
      <div className="term-menu-catch" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      {/* the menu must not run off the window edge: pin it when there is not enough room */}
      <Menu
        menu={menu}
        className="term-menu"
        label={t('common.menu.actions')}
        style={{
          left: Math.min(x, window.innerWidth - 240),
          top: Math.min(y, window.innerHeight - items.length * 30 - 16),
        }}
      >
        {items.map((item) => (
          <Item
            key={item.label}
            className={item.danger ? 'danger' : undefined}
            onClick={() => {
              onClose()
              item.onPick()
            }}
          >
            {item.label}
            {item.hint && <span className="muted small">{item.hint}</span>}
          </Item>
        ))}
      </Menu>
    </>
  )
}
