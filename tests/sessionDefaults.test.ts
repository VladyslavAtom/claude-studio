import { describe, expect, it } from 'vitest'
import { autoBranch, branchFromTask, stamp, worktreePathFor } from '../src/renderer/src/lib/sessionDefaults'

/**
 * The naming a session gets when nobody typed anything. It is shared by the new-session window
 * and by a session an agent opened through its tool, which is the point of it being here at all:
 * two branches named by two copies of these rules would drift apart at the first edit.
 */
describe('branchFromTask', () => {
  it('takes the first sentence, and at most five words of it', () => {
    expect(branchFromTask('Rewrite the diff parser. Then the tests.')).toBe('rewrite-the-diff-parser')
    expect(branchFromTask('one two three four five six seven')).toBe('one-two-three-four-five')
  })

  it('has nothing to say about a task too short to read as a name', () => {
    // `ab` would be a branch nobody can tell apart from another; the date is better
    expect(branchFromTask('ab')).toBeNull()
  })

  it("a task with no letters in it falls to slugify's own fallback, not to null", () => {
    expect(branchFromTask('...')).toBe('session')
    expect(branchFromTask('')).toBe('session')
  })
})

describe('autoBranch', () => {
  it('prefers the name the person typed over the task', () => {
    expect(autoBranch({ name: 'Diff parser', task: 'rewrite everything' }, new Set())).toBe('claude/diff-parser')
  })

  it('falls back to the task, and then to the date', () => {
    expect(autoBranch({ name: null, task: 'rewrite the diff parser' }, new Set())).toBe(
      'claude/rewrite-the-diff-parser',
    )
    // the date is reached only where the task says nothing a name can be made of at all
    expect(autoBranch({ name: null, task: 'ab' }, new Set())).toMatch(/^claude\/\d{4}-\d{2}-\d{2}-\d{4}$/)
  })

  it('does not offer a name git would refuse: a taken one is numbered', () => {
    const taken = new Set(['claude/parser', 'claude/parser-2'])
    expect(autoBranch({ name: 'parser', task: '' }, taken)).toBe('claude/parser-3')
  })
})

describe('worktreePathFor', () => {
  it('puts it inside the project, named after the branch without its prefix', () => {
    expect(worktreePathFor('/repo', 'claude/diff-parser')).toBe('/repo/.worktrees/diff-parser')
  })

  it('keeps a branch that carries a prefix of its own readable as a directory', () => {
    expect(worktreePathFor('/repo', 'feature/Diff Parser')).toBe('/repo/.worktrees/feature-diff-parser')
  })
})

describe('stamp', () => {
  it('is the local date and time to the minute', () => {
    expect(stamp(new Date(2026, 8, 17, 4, 5))).toBe('2026-09-17-0405')
  })
})
