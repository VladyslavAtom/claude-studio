import { describe, expect, it } from 'vitest'
import { appReducer } from '../src/renderer/src/state/appReducer'
import { CLOSED_PROJECTS_KEPT, emptyState, type AppState, type Project, type Session } from '../src/shared/types'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Session 1',
    cwd: '/repo/.worktrees/s1',
    terminals: [],
    activeTerminalId: null,
    createdAt: 0,
    ...over,
  }
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'repo',
    path: '/repo',
    isGit: true,
    sessions: [],
    activeSessionId: null,
    history: [],
    ...over,
  }
}

function stateWith(projects: Project[], over: Partial<AppState> = {}): AppState {
  return { ...emptyState, projects, activeProjectId: projects[0]?.id ?? null, ...over }
}

describe('closing a project', () => {
  it('sets it aside instead of discarding it', () => {
    const p = project({ sessions: [session()], activeSessionId: 's1' })
    const next = appReducer(stateWith([p]), { type: 'projectClosed', projectId: 'p1', closedAt: 1000 })

    expect(next.projects).toEqual([])
    expect(next.activeProjectId).toBeNull()
    expect(next.closedProjects).toHaveLength(1)
    expect(next.closedProjects[0]).toMatchObject({ id: 'p1', path: '/repo', closedAt: 1000 })
    expect(next.closedProjects[0]?.sessions).toHaveLength(1)
    expect(next.closedProjects[0]?.activeSessionId).toBe('s1')
  })

  it('activates a remaining project when the closed one was active', () => {
    const state = stateWith([project(), project({ id: 'p2', path: '/other' })])
    const next = appReducer(state, { type: 'projectClosed', projectId: 'p1', closedAt: 1 })
    expect(next.activeProjectId).toBe('p2')
  })

  it('keeps one entry per path: the same folder closed twice is the same project', () => {
    const first = appReducer(stateWith([project()]), { type: 'projectClosed', projectId: 'p1', closedAt: 1 })
    const reopened = {
      ...first,
      projects: [project({ id: 'p9', sessions: [session()] })],
      closedProjects: first.closedProjects,
    }
    const second = appReducer(reopened, { type: 'projectClosed', projectId: 'p9', closedAt: 2 })

    expect(second.closedProjects).toHaveLength(1)
    expect(second.closedProjects[0]).toMatchObject({ id: 'p9', closedAt: 2 })
  })

  it('remembers newest first and drops the oldest past the cap', () => {
    let state = emptyState
    for (let i = 0; i < CLOSED_PROJECTS_KEPT + 3; i++) {
      const p = project({ id: `p${i}`, path: `/repo${i}` })
      state = { ...state, projects: [p] }
      state = appReducer(state, { type: 'projectClosed', projectId: p.id, closedAt: i })
    }

    expect(state.closedProjects).toHaveLength(CLOSED_PROJECTS_KEPT)
    expect(state.closedProjects[0]?.path).toBe(`/repo${CLOSED_PROJECTS_KEPT + 2}`)
    expect(state.closedProjects.some((p) => p.path === '/repo0')).toBe(false)
  })
})

describe('opening a project again', () => {
  it('restores the closed one whole rather than adding an empty project', () => {
    const p = project({ sessions: [session(), session({ id: 's2' })], activeSessionId: 's2' })
    const closed = appReducer(stateWith([p]), { type: 'projectClosed', projectId: 'p1', closedAt: 1 })

    // what the folder picker builds: a new id, no sessions, same path
    const fresh = project({ id: 'p-new', sessions: [], activeSessionId: null })
    const next = appReducer(closed, { type: 'projectAdded', project: fresh })

    expect(next.projects).toHaveLength(1)
    expect(next.projects[0]?.id).toBe('p1')
    expect(next.projects[0]?.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(next.projects[0]?.activeSessionId).toBe('s2')
    expect(next.activeProjectId).toBe('p1')
    expect(next.closedProjects).toEqual([])
    expect(next.projects[0]).not.toHaveProperty('closedAt')
  })

  it('leaves an already-open project alone and just activates it', () => {
    const state = stateWith([project(), project({ id: 'p2', path: '/other' })], { activeProjectId: 'p2' })
    const next = appReducer(state, { type: 'projectAdded', project: project({ id: 'p-new' }) })

    expect(next.projects).toHaveLength(2)
    expect(next.activeProjectId).toBe('p1')
  })

  it('adds a genuinely new path as a new project', () => {
    const closed = appReducer(stateWith([project()]), { type: 'projectClosed', projectId: 'p1', closedAt: 1 })
    const next = appReducer(closed, { type: 'projectAdded', project: project({ id: 'p2', path: '/elsewhere' }) })

    expect(next.projects.map((p) => p.path)).toEqual(['/elsewhere'])
    expect(next.closedProjects).toHaveLength(1)
  })

  it('forgetting a closed project drops it from the reopen list', () => {
    const closed = appReducer(stateWith([project()]), { type: 'projectClosed', projectId: 'p1', closedAt: 1 })
    const next = appReducer(closed, { type: 'closedProjectForgotten', projectId: 'p1' })

    expect(next.closedProjects).toEqual([])
    // and the folder now opens as a fresh project
    const added = appReducer(next, { type: 'projectAdded', project: project({ id: 'p-new' }) })
    expect(added.projects[0]?.id).toBe('p-new')
    expect(added.projects[0]?.sessions).toEqual([])
  })
})

describe('sessions whose directory vanished while the project was closed', () => {
  it('move into the project history instead of staying in the list', () => {
    const p = project({
      sessions: [session(), session({ id: 's2', cwd: '/repo/.worktrees/s2' })],
      activeSessionId: 's2',
    })
    const next = appReducer(stateWith([p]), {
      type: 'projectSessionsPruned',
      projectId: 'p1',
      sessionIds: ['s2'],
      prunedAt: 500,
    })

    expect(next.projects[0]?.sessions.map((s) => s.id)).toEqual(['s1'])
    expect(next.projects[0]?.activeSessionId).toBe('s1')
    expect(next.projects[0]?.history?.[0]).toMatchObject({ id: 's2', closedAt: 500, worktreeRemoved: true })
  })

  it('is a no-op when every directory is still there', () => {
    const state = stateWith([project({ sessions: [session()] })])
    const next = appReducer(state, { type: 'projectSessionsPruned', projectId: 'p1', sessionIds: [], prunedAt: 1 })
    expect(next).toBe(state)
  })
})
