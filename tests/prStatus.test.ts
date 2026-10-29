import { describe, expect, it } from 'vitest'
import {
  checkOutcome,
  classifyGhFailure,
  needsAsk,
  NO_PR_TTL_MS,
  parsePrResponse,
  parseUpstream,
  PENDING_MIN_MS,
  prQuery,
  SETTLED_TTL_MS,
} from '../src/main/gh'
import { checksRollup, mergePrs, pendingCwds } from '../src/renderer/src/lib/prStatus'
import type { PrInfo } from '../src/shared/types'

const line = (...f: string[]): string => f.join('\0')

describe('parseUpstream', () => {
  const refs = [
    line('*', 'refs/heads/feat', 'aaa', 'refs/remotes/origin/feat-remote', 'refs/heads/feat-remote'),
    line(' ', 'refs/heads/main', 'bbb', 'refs/remotes/origin/main', 'refs/heads/main'),
    line(' ', 'refs/remotes/origin/feat-remote', 'ccc', '', ''),
    line(' ', 'refs/remotes/origin/main', 'bbb', '', ''),
  ].join('\n')

  it('takes the remote name of the checked-out branch and the sha of its tracking ref', () => {
    expect(parseUpstream(refs)).toEqual({ head: 'feat-remote', sha: 'ccc' })
  })

  it('is null for a branch never pushed, a local upstream, a gone remote branch, a detached HEAD', () => {
    expect(parseUpstream(line('*', 'refs/heads/x', 'aaa', '', ''))).toBeNull()
    expect(parseUpstream(line('*', 'refs/heads/x', 'aaa', 'refs/heads/main', 'refs/heads/main'))).toBeNull()
    expect(parseUpstream(line('*', 'refs/heads/x', 'aaa', 'refs/remotes/origin/x', 'refs/heads/x'))).toBeNull()
    expect(parseUpstream(line(' ', 'refs/heads/x', 'aaa', 'refs/remotes/origin/x', 'refs/heads/x'))).toBeNull()
  })
})

const pr = (over: Partial<PrInfo> = {}): PrInfo => ({
  number: 1,
  state: 'open',
  url: 'https://github.com/o/r/pull/1',
  checks: { pass: 1, fail: 0, pending: 0, skipped: 0, items: [], truncated: false },
  ...over,
})

describe('needsAsk', () => {
  const now = 1_000_000_000
  it('asks when nothing is cached, the upstream moved, or forced', () => {
    expect(needsAsk(undefined, 's', now)).toBe(true)
    expect(needsAsk({ sha: 'old', at: now, pr: pr() }, 's', now)).toBe(true)
    expect(needsAsk({ sha: 's', at: now, pr: pr() }, 's', now, true)).toBe(true)
  })

  it('holds a settled answer on the same sha, and re-asks only after its TTL', () => {
    expect(needsAsk({ sha: 's', at: now, pr: pr() }, 's', now + SETTLED_TTL_MS - 1)).toBe(false)
    expect(needsAsk({ sha: 's', at: now, pr: pr() }, 's', now + SETTLED_TTL_MS)).toBe(true)
  })

  it('re-asks pending checks sooner, and «no PR» sooner still than settled', () => {
    const pending = pr({ checks: { pass: 0, fail: 0, pending: 2, skipped: 0, items: [], truncated: false } })
    expect(needsAsk({ sha: 's', at: now, pr: pending }, 's', now + PENDING_MIN_MS - 1)).toBe(false)
    expect(needsAsk({ sha: 's', at: now, pr: pending }, 's', now + PENDING_MIN_MS)).toBe(true)
    expect(needsAsk({ sha: 's', at: now, pr: null }, 's', now + NO_PR_TTL_MS - 1)).toBe(false)
    expect(needsAsk({ sha: 's', at: now, pr: null }, 's', now + NO_PR_TTL_MS)).toBe(true)
  })

  it('treats pending checks on a merged PR as settled', () => {
    const merged = pr({
      state: 'merged',
      checks: { pass: 0, fail: 0, pending: 1, skipped: 0, items: [], truncated: false },
    })
    expect(needsAsk({ sha: 's', at: now, pr: merged }, 's', now + PENDING_MIN_MS)).toBe(false)
  })
})

describe('classifyGhFailure', () => {
  it('sorts gh failures into pauses', () => {
    expect(classifyGhFailure({ stderr: '', code: 1, message: { code: 'git-not-found', params: {} } })).toBe('missing')
    expect(classifyGhFailure({ stderr: 'GraphQL: API rate limit exceeded for user ID 1.', code: 1 })).toBe('rate-limit')
    expect(classifyGhFailure({ stderr: 'gh: Bad credentials (HTTP 401)', code: 1 })).toBe('auth')
    expect(classifyGhFailure({ stderr: 'To get started with GitHub CLI, please run:  gh auth login', code: 4 })).toBe(
      'auth',
    )
    // this one also says «gh auth login»: the remote, not the sign-in, is what is missing
    expect(
      classifyGhFailure({
        stderr:
          'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`',
        code: 1,
      }),
    ).toBe('no-remote')
    expect(classifyGhFailure({ stderr: 'GraphQL: Could not resolve to a Repository', code: 1 })).toBe('failed')
  })
})

describe('checkOutcome', () => {
  it('buckets check runs and commit statuses as gh pr checks does', () => {
    expect(checkOutcome({ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null })).toBe('pending')
    expect(checkOutcome({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' })).toBe('pass')
    expect(checkOutcome({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'CANCELLED' })).toBe('fail')
    expect(checkOutcome({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' })).toBe('skipped')
    expect(checkOutcome({ __typename: 'StatusContext', state: 'PENDING' })).toBe('pending')
    expect(checkOutcome({ __typename: 'StatusContext', state: 'ERROR' })).toBe('fail')
  })
})

describe('prQuery / parsePrResponse', () => {
  it('declares one variable and one alias per branch', () => {
    const q = prQuery(2)
    expect(q).toContain('$h0:String!,$h1:String!')
    expect(q).toContain('b1:pullRequests(headRefName:$h1')
  })

  // the shape `gh api graphql` returned for cli/cli on 2026-10-29, trimmed
  const stdout = JSON.stringify({
    data: {
      repository: {
        b0: {
          nodes: [
            {
              number: 14846,
              state: 'OPEN',
              isDraft: true,
              url: 'https://github.com/cli/cli/pull/14846',
              commits: {
                nodes: [
                  {
                    commit: {
                      statusCheckRollup: {
                        contexts: {
                          totalCount: 3,
                          nodes: [
                            {
                              __typename: 'CheckRun',
                              name: 'build',
                              status: 'COMPLETED',
                              conclusion: 'SUCCESS',
                              detailsUrl: 'https://github.com/cli/cli/actions/runs/1/job/2',
                            },
                            {
                              __typename: 'CheckRun',
                              name: 'lint',
                              status: 'QUEUED',
                              conclusion: null,
                              detailsUrl: null,
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
        b1: { nodes: [] },
        b2: { nodes: [{ number: 7, state: 'MERGED', isDraft: false, url: 'u', commits: { nodes: [] } }] },
      },
    },
  })

  it('maps each alias to a PR, with checks counted per outcome', () => {
    const out = parsePrResponse(stdout, 3)
    expect(out?.[0]).toEqual({
      number: 14846,
      state: 'draft',
      url: 'https://github.com/cli/cli/pull/14846',
      checks: {
        pass: 1,
        fail: 0,
        pending: 1,
        skipped: 0,
        truncated: true,
        items: [
          { name: 'build', outcome: 'pass', url: 'https://github.com/cli/cli/actions/runs/1/job/2' },
          { name: 'lint', outcome: 'pending' },
        ],
      },
    })
    expect(out?.[1]).toBeNull()
    expect(out?.[2]).toEqual({ number: 7, state: 'merged', url: 'u', checks: null })
  })

  it('is null for output that is not the expected shape', () => {
    expect(parsePrResponse('not json', 1)).toBeNull()
    expect(parsePrResponse('{"data":{"repository":null}}', 1)).toBeNull()
  })
})

describe('renderer: mergePrs, pendingCwds, checksRollup', () => {
  it('replaces asked directories, drops those without an answer, keeps the object when unchanged', () => {
    const prev = { '/a': pr(), '/b': null }
    expect(mergePrs(prev, ['/a'], { '/a': pr() })).toBe(prev)
    expect(mergePrs(prev, ['/b'], {})).toEqual({ '/a': pr() })
    expect(mergePrs(prev, ['/c'], { '/c': null })).toEqual({ '/a': pr(), '/b': null, '/c': null })
  })

  it('lists only open PRs with running checks, and rolls the checks up worst first', () => {
    const running = pr({ checks: { pass: 1, fail: 1, pending: 1, skipped: 0, items: [], truncated: false } })
    expect(pendingCwds({ '/a': running, '/b': pr(), '/c': null, '/d': { ...running, state: 'closed' } })).toEqual([
      '/a',
    ])
    expect(checksRollup(running)).toBe('fail')
    expect(checksRollup(pr())).toBe('pass')
    expect(checksRollup(pr({ checks: null }))).toBe('none')
  })
})
