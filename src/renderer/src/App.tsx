import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import type { ChangeStatus, Project } from '../../shared/types'
import { I18nProvider, useT } from './i18n'
import { ThemeProvider } from './theme/ThemeProvider'
import ProjectTabs from './components/ProjectTabs'
import SessionList from './components/SessionList'
import TerminalArea from './components/TerminalArea'
import ChangesPanel from './components/ChangesPanel'
import FileTree from './components/FileTree'
import NewSessionModal from './components/NewSessionModal'
import CloneModal from './components/CloneModal'
import CloseSessionModal from './components/CloseSessionModal'
import SettingsPage from './components/SettingsPage'
import StartupModal from './components/StartupModal'
import AgentHistoryModal from './components/AgentHistoryModal'
import Splitter from './components/Splitter'
import { COLLAPSED_W } from './hooks/useLayout'
import { diffTab, fileTab, mergeTab } from './hooks/useTerminalActions'
import { ActionsProvider } from './state/ActionsProvider'
import { useActions } from './state/actionsContext'
import { AppStateProvider } from './state/AppStateProvider'
import { useAppState, useDispatch, useLoaded } from './state/appStateContext'
import { RuntimeProvider } from './state/RuntimeProvider'
import { useRuntimeActions, useRuntimeState } from './state/runtimeContext'
import { useActiveProject, useActiveSession } from './state/selectors'
import { UiProvider } from './state/UiProvider'
import { useUiActions, useUiState } from './state/uiContext'

/**
 * The UI layer wraps the state layer, not the other way round: persistence lives inside
 * AppStateProvider and has to be able to report a refused save through the same toast as
 * everything else. Nothing in UiProvider reads the persisted state, so it can go outermost.
 *
 * The language and the theme sit between them: both are settings, so they can only be read once
 * the state is there, and everything that shows a word or a colour has to be under them.
 */
export default function App(): JSX.Element {
  return (
    <UiProvider>
      <AppStateProvider>
        <Chrome>
          <RuntimeProvider>
            <ActionsProvider>
              <Shell />
            </ActionsProvider>
          </RuntimeProvider>
        </Chrome>
      </AppStateProvider>
    </UiProvider>
  )
}

/** the saved language and theme, or neither — then each provider follows the system */
function Chrome({ children }: { children: ReactNode }): JSX.Element {
  const { settings } = useAppState()
  return (
    <I18nProvider locale={settings.locale}>
      <ThemeProvider choice={settings.theme}>{children}</ThemeProvider>
    </I18nProvider>
  )
}

function Shell(): JSX.Element {
  const loaded = useLoaded()
  const state = useAppState()
  const dispatch = useDispatch()
  const { awake, attention, busyIds, agentActivity } = useRuntimeState()
  const { modal } = useUiState()
  const { openModal, closeModal, setBusy, setError } = useUiActions()
  const { projects } = useActions()
  const activeProject = useActiveProject()
  const t = useT()

  if (!loaded) return <div className="boot">{t('common.loading')}</div>

  return (
    <div className="app">
      <ProjectTabs
        projects={state.projects}
        closedProjects={state.closedProjects}
        awake={awake}
        attention={attention}
        busyIds={busyIds}
        agentActivity={agentActivity}
        activeId={state.activeProjectId}
        onSelect={projects.selectProject}
        onClose={projects.closeProject}
        onReopen={(id) => void projects.reopenProject(id)}
        onForgetClosed={projects.forgetClosedProject}
        onReorder={projects.reorderProjects}
        onOpenFolder={projects.openFolder}
        onClone={() => openModal({ kind: 'clone' })}
        onSettings={() => openModal({ kind: 'settings', tab: 'agents' })}
        onError={setError}
        onInfo={setBusy}
        onNewWorktree={(baseRef) => {
          if (!activeProject) return
          openModal({ kind: 'newSession', project: activeProject, baseRef })
        }}
        onRename={projects.renameProject}
        pullStrategy={state.settings.pullStrategy}
        onPullStrategy={(pullStrategy) => dispatch({ type: 'settingsPatched', patch: { pullStrategy } })}
      />

      {modal?.kind === 'settings' ? (
        <SettingsPage
          settings={state.settings}
          initialTab={modal.tab}
          onClose={closeModal}
          onSave={(settings) => dispatch({ type: 'settingsSaved', settings })}
        />
      ) : activeProject ? (
        <Workspace project={activeProject} />
      ) : (
        <div className="empty-project">
          <h1>Claude Studio</h1>
          <p>{t('projects.empty.hint')}</p>
          <div className="row">
            <button className="primary" onClick={() => void projects.openFolder()}>
              {t('projects.empty.open')}
            </button>
            <button onClick={() => openModal({ kind: 'clone' })}>{t('projects.empty.clone')}</button>
          </div>
        </div>
      )}

      <Toasts />
      <ModalHost activeProject={activeProject} />
    </div>
  )
}

function Workspace({ project }: { project: Project }): JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const t = useT()
  const activeSession = useActiveSession(project)
  const { awake, attention, busyIds, agentActivity, silent, snapshots } = useRuntimeState()
  const { markActivity, markSeen, onBell, rememberSnapshot } = useRuntimeActions()
  const { sessions, terminals, layout } = useActions()
  const { openModal, setBusy, setError } = useUiActions()
  /** what changed in the current session's directory: the changes panel already knows, the tree colours it */
  const [changedFiles, setChangedFiles] = useState<Record<string, ChangeStatus>>({})
  const { filesOpen, changesCollapsed, layout: sizes } = layout

  return (
    <div className="workspace">
      <div className="pane" style={{ width: sizes.sessions }}>
        <SessionList
          project={project}
          awake={awake}
          attention={attention}
          busyIds={busyIds}
          agentActivity={agentActivity}
          onSelect={(id) => sessions.selectSession(project, id)}
          onNew={() => openModal({ kind: 'newSession', project })}
          onClose={(session) => openModal({ kind: 'closeSession', project, session })}
          onRename={(session, name) => sessions.renameSession(project, session, name)}
          onReorder={(from, to) => sessions.reorderSessions(project, from, to)}
          onRestore={(archived) => void sessions.restoreSession(project, archived)}
          onForget={(id) => sessions.forgetSession(project, id)}
          onAgentHistory={() => openModal({ kind: 'agentHistory' })}
          filesOpen={filesOpen}
          onToggleFiles={() => layout.togglePanel('filesOpen')}
        />
      </div>
      <Splitter onResize={(dx: number) => layout.resize('sessions', dx)} />

      {activeSession ? (
        <>
          {filesOpen && (
            <>
              <div className="pane" style={{ width: sizes.files }}>
                <FileTree
                  root={activeSession.cwd}
                  changed={changedFiles}
                  selected={
                    activeSession.terminals.find((t) => t.id === activeSession.activeTerminalId)?.filePath ?? null
                  }
                  onOpen={(path) => terminals.openTab(project, activeSession, fileTab(path))}
                  onClose={() => layout.setPanel('filesOpen', false)}
                />
              </div>
              <Splitter onResize={(dx: number) => layout.resize('files', dx)} />
            </>
          )}

          <div className="center-stack">
            <TerminalArea
              key={activeSession.id}
              session={activeSession}
              settings={state.settings}
              awake={awake}
              attention={attention}
              busyIds={busyIds}
              agentActivity={agentActivity}
              silent={silent}
              snapshots={snapshots}
              onSnapshot={rememberSnapshot}
              onSleepTerminal={terminals.sleepTerminal}
              onWake={(id) => terminals.wakeTerminal(project, activeSession, id)}
              onBell={(id) => onBell(project, activeSession, id)}
              onActivity={markActivity}
              onSeen={markSeen}
              onSelectTerminal={(id) => terminals.selectTerminal(project, activeSession, id)}
              onAddTerminal={(agentId) => terminals.addTerminal(project, activeSession, agentId)}
              onCloseTerminal={(id) => void terminals.closeTerminal(project, activeSession, id)}
              onRenameTerminal={(id, title) => terminals.renameTerminal(project, activeSession, id, title)}
              onReorderTerminals={(from, to) => terminals.reorderTerminals(project, activeSession, from, to)}
              onTerminalTitle={(terminalId, title) => terminals.observeTitle(project, activeSession, terminalId, title)}
              onTerminalCommand={(terminalId, cmd) => terminals.observeCommand(project, activeSession, terminalId, cmd)}
              onRestoreRun={(run) => terminals.restoreRun(project, activeSession, run)}
              onSendToAgent={(text: string) => terminals.sendToActiveTerminal(activeSession, text)}
              onOpenPath={(path, line) => void terminals.openPathFromTerminal(project, activeSession, path, line)}
              onLaunchedChange={(terminalId, launched) =>
                terminals.setLaunched(project, activeSession, terminalId, launched)
              }
              onError={setError}
              defaultAgentId={
                state.settings.lastAgentId === undefined
                  ? (state.settings.agents.find((a) => a.enabled)?.id ?? null)
                  : state.settings.lastAgentId
              }
              onDefaultAgent={(agentId) => dispatch({ type: 'settingsPatched', patch: { lastAgentId: agentId } })}
            />
          </div>

          {!changesCollapsed && <Splitter onResize={(dx: number) => layout.resize('changes', dx)} />}
          <div className="pane" style={{ width: changesCollapsed ? COLLAPSED_W : sizes.changes }}>
            <ChangesPanel
              session={activeSession}
              projectPath={project.path}
              settings={state.settings}
              onOpenDiff={(spec) => terminals.openTab(project, activeSession, diffTab(spec))}
              onOpenMerge={(cwd, path) => terminals.openTab(project, activeSession, mergeTab(cwd, path))}
              agentTabId={
                activeSession.terminals.find(
                  (t) => t.kind === 'agent' && awake.has(t.id) && t.id === activeSession.activeTerminalId,
                )?.id ??
                activeSession.terminals.find((t) => t.kind === 'agent' && awake.has(t.id))?.id ??
                null
              }
              onOpenCommitSettings={() => openModal({ kind: 'settings', tab: 'commits' })}
              onChangedFiles={setChangedFiles}
              onPullStrategy={(pullStrategy) => dispatch({ type: 'settingsPatched', patch: { pullStrategy } })}
              collapsed={changesCollapsed}
              onToggleCollapsed={(collapsed) => layout.setPanel('changesCollapsed', collapsed)}
              onError={setError}
              onInfo={setBusy}
            />
          </div>
        </>
      ) : (
        <div className="empty-session">
          <p>{t('sessions.empty.title')}</p>
          <button className="primary" onClick={() => openModal({ kind: 'newSession', project })}>
            {t('sessions.empty.new')}
          </button>
        </div>
      )}
    </div>
  )
}

function Toasts(): JSX.Element {
  const { busy, error } = useUiState()
  const { setError } = useUiActions()
  const t = useT()
  return (
    <>
      {busy && <div className="toast">{busy}</div>}
      {error && (
        <div className="toast error" onClick={() => setError(null)}>
          {error}
          <span className="hint">{t('common.toast.dismiss')}</span>
        </div>
      )}
    </>
  )
}

function ModalHost({ activeProject }: { activeProject: Project | null }): JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const { modal } = useUiState()
  const { closeModal, setBusy, setError } = useUiActions()
  const { projects, sessions, startAllAgents } = useActions()

  if (!modal) return null

  switch (modal.kind) {
    case 'startup':
      return (
        <StartupModal
          agents={modal.agents}
          sessions={modal.sessions}
          onAll={startAllAgents}
          onNone={closeModal}
          onRemember={(startup) => dispatch({ type: 'settingsPatched', patch: { startup } })}
        />
      )

    case 'agentHistory':
      if (!activeProject) return null
      return (
        <AgentHistoryModal
          project={activeProject}
          settings={state.settings}
          onCancel={closeModal}
          onOpen={(entry) => void sessions.openExternalSession(activeProject, entry)}
          onError={setError}
        />
      )

    case 'newSession':
      return (
        <NewSessionModal
          project={modal.project}
          agents={state.settings.agents}
          // no base ref: the prop is left off entirely rather than passed as undefined, which is
          // what the modal reads as "pick the default"
          {...(modal.baseRef ? { initialBase: modal.baseRef } : {})}
          onCancel={closeModal}
          onConfirm={(res) => {
            const project = modal.project
            closeModal()
            void sessions.createSession(project, res)
          }}
        />
      )

    case 'clone':
      return (
        <CloneModal
          onCancel={closeModal}
          onCloned={async (path) => {
            closeModal()
            await projects.addProject(path)
          }}
          setBusy={setBusy}
          setError={setError}
        />
      )

    case 'closeSession':
      return (
        <CloseSessionModal
          session={modal.session}
          onCancel={closeModal}
          onConfirm={(removeWorktree, deleteBranch) => {
            const { project, session } = modal
            closeModal()
            void sessions.closeSession(project, session, removeWorktree, deleteBranch)
          }}
        />
      )

    default:
      return null
  }
}
