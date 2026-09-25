import type { ButtonHTMLAttributes, CSSProperties, JSX, ReactNode } from 'react'
import { OverlayDepth } from './overlay'
import type { MenuHandle } from './useMenu'

interface Props {
  /** the popup half of the handle; `rootRef` stays with the caller's wrapper element */
  menu: Pick<MenuHandle, 'menuRef' | 'depth' | 'onKeyDown'>
  /** existing class of the popup: the stylesheet keeps owning how it looks */
  className: string
  /** 'none' for popups that hold more than commands (a filter field, groups, captions) */
  role?: 'menu' | 'listbox' | 'none'
  label?: string
  style?: CSSProperties
  children: ReactNode
}

/** the popup half of {@link useMenu}: roles, arrow keys and the nesting level for Escape */
export function Menu({ menu, className, role = 'menu', label, style, children }: Props): JSX.Element {
  // bound once instead of read as `menu.menuRef` below: the handle carries refs, and reading a
  // member off it mid-render is indistinguishable, to the analyzer, from reading `.current`
  const { menuRef, depth, onKeyDown } = menu
  return (
    <OverlayDepth.Provider value={depth}>
      <div
        ref={menuRef}
        className={className}
        style={style}
        role={role === 'none' ? undefined : role}
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </OverlayDepth.Provider>
  )
}

type ItemProps = ButtonHTMLAttributes<HTMLButtonElement> & { role?: 'menuitem' | 'option' }

/** one command in a {@link Menu}: focus moves by arrows, so items stay out of the Tab order */
export function MenuItem({ role = 'menuitem', ...rest }: ItemProps): JSX.Element {
  return <button type="button" role={role} tabIndex={-1} {...rest} />
}

/** divider between groups; `.sep` is the class the stylesheet already knows */
export function MenuSep(): JSX.Element {
  return <div className="sep" role="separator" />
}
