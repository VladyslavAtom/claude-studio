import { useCallback, useMemo } from 'react'
import type { LayoutConfig } from '../../../shared/types'
import { useAppState, useDispatch } from '../state/appStateContext'
import { useSettingsRef } from '../state/selectors'

/** width of the changes panel when it is collapsed to its handle */
export const COLLAPSED_W = 30

type PanelKey = 'filesOpen' | 'changesCollapsed'
type WidthKey = 'sessions' | 'files' | 'changes'

/** the limits of each panel and which way its splitter pulls it */
const WIDTHS: Record<WidthKey, { min: number; max: number; sign: 1 | -1 }> = {
  sessions: { min: 150, max: 520, sign: 1 },
  files: { min: 160, max: 560, sign: 1 },
  changes: { min: 220, max: 720, sign: -1 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface LayoutActions {
  layout: LayoutConfig
  // whether the files panel is open and the changes panel collapsed is part of the layout, not
  // of the session: there is no reason to close them again after every start
  filesOpen: boolean
  changesCollapsed: boolean
  setPanel: (key: PanelKey, value: boolean) => void
  togglePanel: (key: PanelKey) => void
  /** the splitter was dragged by dx pixels */
  resize: (key: WidthKey, dx: number) => void
}

export function useLayout(): LayoutActions {
  const layout = useAppState().settings.layout
  const settingsRef = useSettingsRef()
  const dispatch = useDispatch()

  const setPanel = useCallback(
    (key: PanelKey, value: boolean) => {
      const patch: Partial<LayoutConfig> = {}
      patch[key] = value
      dispatch({ type: 'layoutChanged', patch })
    },
    [dispatch],
  )

  const togglePanel = useCallback((key: PanelKey) => dispatch({ type: 'panelToggled', key }), [dispatch])

  const resize = useCallback(
    (key: WidthKey, dx: number) => {
      const { min, max, sign } = WIDTHS[key]
      const patch: Partial<LayoutConfig> = {}
      patch[key] = Math.round(clamp(settingsRef.current.layout[key] + sign * dx, min, max))
      dispatch({ type: 'layoutChanged', patch })
    },
    [dispatch, settingsRef],
  )

  return useMemo(
    () => ({
      layout,
      filesOpen: layout.filesOpen,
      changesCollapsed: layout.changesCollapsed,
      setPanel,
      togglePanel,
      resize,
    }),
    [layout, setPanel, togglePanel, resize],
  )
}
