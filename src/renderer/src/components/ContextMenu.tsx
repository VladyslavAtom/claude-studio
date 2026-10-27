import type { JSX, KeyboardEvent } from 'react'
import { Fragment, useState } from 'react'
import { Menu, MenuItem as Item, MenuSep } from '../ui/Menu'
import { OverlayDepth } from '../ui/overlay'
import { useT } from '../i18n'
import { useMenu } from '../ui/useMenu'

interface ItemBase {
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** a divider above this item: groups are drawn, not inferred */
  sep?: boolean
  /** a colour sample before the label: a CSS value, a token through `var()` */
  swatch?: string
}

/** a command, or a group that opens a submenu (`New ▸`, `Git ▸`) — never both */
export type MenuItem = ItemBase & ({ onPick: () => void; items?: never } | { items: MenuItem[]; onPick?: never })

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

const WIDTH = 240
const ROW = 30

/** where a popup of `count` rows goes so that it does not run off the window edge */
function clamp(x: number, y: number, count: number): { left: number; top: number } {
  return { left: Math.max(0, Math.min(x, window.innerWidth - WIDTH)), top: Math.max(0, Math.min(y, window.innerHeight - count * ROW - 16)) }
}

function Rows({
  items,
  onClose,
  onEnter,
}: {
  items: MenuItem[]
  onClose: () => void
  /** a row was hovered or opened by key: which one, its element, and whether by keyboard */
  onEnter?: (index: number, el: HTMLElement, byKey: boolean) => void
}): JSX.Element {
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {item.sep && i > 0 && <MenuSep />}
          <Item
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            aria-haspopup={item.items ? 'menu' : undefined}
            onMouseEnter={(e) => onEnter?.(i, e.currentTarget, false)}
            onKeyDown={(e) => {
              if (item.items && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onEnter?.(i, e.currentTarget, true)
              }
            }}
            onClick={(e) => {
              if (item.items) {
                onEnter?.(i, e.currentTarget, e.detail === 0)
                return
              }
              onClose()
              item.onPick()
            }}
          >
            {item.swatch ? (
              <span className="with-swatch">
                <span className="swatch" style={{ background: item.swatch }} aria-hidden="true" />
                {item.label}
              </span>
            ) : (
              item.label
            )}
            {item.hint && <span className="muted small">{item.hint}</span>}
          </Item>
        </Fragment>
      ))}
    </>
  )
}

/** one level down: Escape or ← closes it and gives focus back to the row that opened it */
function Submenu({
  items,
  left,
  top,
  byKey,
  onBack,
  onClose,
}: {
  items: MenuItem[]
  left: number
  top: number
  byKey: boolean
  onBack: () => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  // focus moves in only when the submenu was opened by key; a hover leaves it where it is
  const menu = useMenu(true, onBack, { autoFocus: byKey })
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft') return
    e.preventDefault()
    onBack()
  }
  return (
    <div onKeyDown={onKeyDown}>
      <Menu menu={menu} className="term-menu" label={t('common.menu.actions')} style={{ left, top }}>
        <Rows items={items} onClose={onClose} />
      </Menu>
    </div>
  )
}

/**
 * Right-click menu. Shared by project, session and terminal tabs and the file tree: the items
 * differ, the behaviour does not, and there is no reason for it to drift apart.
 *
 * A submenu is a sibling of the menu, not a child of it: the menu's arrow keys walk only its own
 * rows that way. Both sit inside one wrapper, which is the outside-click boundary, so a click in
 * the submenu does not count as a click outside the menu.
 */
export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const t = useT()
  // the menu only exists while it is open, so it is always the open one
  const menu = useMenu(true, onClose)
  // bound once rather than read as `menu.x` below: the handle carries refs, and a member read off
  // it mid-render looks, to the analyzer, like reading `.current`
  const { rootRef, depth } = menu
  const [sub, setSub] = useState<{ index: number; left: number; top: number; byKey: boolean; from: HTMLElement } | null>(
    null,
  )

  const onEnter = (index: number, el: HTMLElement, byKey: boolean): void => {
    const children = items[index]?.items
    if (!children) {
      setSub(null)
      return
    }
    if (sub?.index === index && !byKey) return
    const rect = el.getBoundingClientRect()
    setSub({ index, ...clamp(rect.right - 2, rect.top - 4, children.length), byKey, from: el })
  }

  const subItems = sub ? items[sub.index]?.items : undefined

  return (
    <>
      <div className="term-menu-catch" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div ref={rootRef}>
        <Menu menu={menu} className="term-menu" label={t('common.menu.actions')} style={clamp(x, y, items.length)}>
          <Rows items={items} onClose={onClose} onEnter={onEnter} />
        </Menu>
        {sub && subItems && (
          <OverlayDepth.Provider value={depth}>
            <Submenu
              key={sub.index}
              items={subItems}
              left={sub.left}
              top={sub.top}
              byKey={sub.byKey}
              onBack={() => {
                sub.from.focus()
                setSub(null)
              }}
              onClose={onClose}
            />
          </OverlayDepth.Provider>
        )}
      </div>
    </>
  )
}
