import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { commandFor, commandForRun, findAgent, parseEnv, titleFor } from '../src/renderer/src/lib/agents'
import type { AgentDef, AgentRun, Settings, TerminalTab } from '../src/shared/types'

function agent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'claude',
    name: 'Claude',
    preset: 'claude',
    command: 'claude',
    args: ['--session-id', '{session}'],
    resumeArgs: ['--resume', '{session}'],
    historyArgs: ['--resume'],
    sessionSource: 'uuid',
    extraArgs: [],
    env: {},
    color: '#79b8ff',
    enabled: true,
    ...over,
  }
}

function tab(over: Partial<TerminalTab> = {}): TerminalTab {
  return { id: 't1', kind: 'agent', title: 'Claude', ...over }
}

const SID = '6f1d2c3b-0000-4000-8000-000000000001'

describe('commandFor — {session} substitution', () => {
  it('returns undefined without an agent', () => {
    expect(commandFor(null, tab())).toBeUndefined()
  })

  it('fills {session} on a fresh run', () => {
    expect(commandFor(agent(), tab({ agentSessionId: SID }))).toBe(`claude --session-id ${SID}`)
  })

  it('drops the placeholder argument when there is no session id', () => {
    // fill() replaces {session} with '' and then filters the empty argument out entirely,
    // so the CLI never sees a bare `--session-id` with nothing after it
    expect(commandFor(agent(), tab())).toBe('claude --session-id')
  })

  it('uses resumeArgs once the tab has been launched', () => {
    expect(commandFor(agent(), tab({ launched: true, agentSessionId: SID }))).toBe(`claude --resume ${SID}`)
  })

  it('falls back to historyArgs when resuming without an id', () => {
    expect(commandFor(agent(), tab({ launched: true }))).toBe('claude --resume')
  })

  it('does not fall back when resumeArgs need no session id', () => {
    const a = agent({ resumeArgs: ['--continue'], historyArgs: ['--pick'] })
    expect(commandFor(a, tab({ launched: true }))).toBe('claude --continue')
  })

  it('substitutes only the first occurrence of a placeholder', () => {
    const a = agent({ args: ['{session}', '{session}'] })
    expect(commandFor(a, tab({ agentSessionId: SID }))).toBe(`claude ${SID} ${SID}`)
  })

  it('replaces {session} inside a larger argument', () => {
    // `=` and `-` are shell-safe, so the joined argument needs no quotes
    const a = agent({ args: ['--id={session}'] })
    expect(commandFor(a, tab({ agentSessionId: SID }))).toBe(`claude --id=${SID}`)
  })
})

describe('commandFor — {name} substitution', () => {
  it('fills {name} from the tab title', () => {
    const a = agent({ args: ['-n', '{name}'] })
    expect(commandFor(a, tab({ title: 'refactor' }))).toBe('claude -n refactor')
  })

  it('strips double quotes out of the name before quoting', () => {
    const a = agent({ args: ['{name}'] })
    expect(commandFor(a, tab({ title: 'say "hi"' }))).toBe("claude 'say hi'")
  })

  it('drops the argument when the title is empty', () => {
    const a = agent({ args: ['-n', '{name}'] })
    expect(commandFor(a, tab({ title: '' }))).toBe('claude -n')
  })
})

describe('commandFor — quoting', () => {
  it('leaves shell-safe arguments bare', () => {
    const a = agent({ args: ['--model', 'sonnet-4.5', 'a_b@c%d+e=f:g,h/i.j-k'] })
    expect(commandFor(a, tab())).toBe('claude --model sonnet-4.5 a_b@c%d+e=f:g,h/i.j-k')
  })

  it('quotes anything with a space', () => {
    const a = agent({ args: ['two words'] })
    expect(commandFor(a, tab())).toBe("claude 'two words'")
  })

  it('quotes shell metacharacters so they cannot execute', () => {
    const a = agent({ args: ['$(rm -rf /)', '`id`', 'a;b', 'a|b', 'a&b', 'a>b', '*'] })
    expect(commandFor(a, tab())).toBe("claude '$(rm -rf /)' '`id`' 'a;b' 'a|b' 'a&b' 'a>b' '*'")
  })

  it('escapes embedded single quotes the POSIX way', () => {
    const a = agent({ args: ["it's"] })
    expect(commandFor(a, tab())).toBe("claude 'it'\\''s'")
  })

  it('escapes every single quote, not just the first', () => {
    const a = agent({ args: ["'a'b'"] })
    expect(commandFor(a, tab())).toBe("claude ''\\''a'\\''b'\\'''")
  })

  it('quotes non-ASCII, because \\w is ASCII-only', () => {
    const a = agent({ args: ['привет'] })
    expect(commandFor(a, tab())).toBe("claude 'привет'")
  })

  it('quotes a newline inside an argument', () => {
    const a = agent({ args: ['a\nb'] })
    expect(commandFor(a, tab())).toBe("claude 'a\nb'")
  })
})

describe('commandFor — start prompt and extra args', () => {
  it('appends the start prompt as a positional argument on a fresh run', () => {
    expect(commandFor(agent(), tab({ agentSessionId: SID, startPrompt: 'fix the parser' }))).toBe(
      `claude --session-id ${SID} 'fix the parser'`,
    )
  })

  it('does not repeat the start prompt when resuming', () => {
    expect(commandFor(agent(), tab({ launched: true, agentSessionId: SID, startPrompt: 'fix the parser' }))).toBe(
      `claude --resume ${SID}`,
    )
  })

  it('quotes a prompt containing a single quote', () => {
    expect(commandFor(agent({ args: [] }), tab({ startPrompt: "don't break it" }))).toBe("claude 'don'\\''t break it'")
  })

  it('adds extraArgs to both fresh and resumed runs', () => {
    const a = agent({ extraArgs: ['--verbose'] })
    expect(commandFor(a, tab({ agentSessionId: SID }))).toBe(`claude --session-id ${SID} --verbose`)
    expect(commandFor(a, tab({ launched: true, agentSessionId: SID }))).toBe(`claude --resume ${SID} --verbose`)
  })

  it('substitutes placeholders inside extraArgs too', () => {
    const a = agent({ args: [], extraArgs: ['--tag={name}'] })
    expect(commandFor(a, tab({ title: 'work' }))).toBe('claude --tag=work')
    expect(commandFor(agent({ args: [], extraArgs: ['--tag={name}'] }), tab({ title: 'two words' }))).toBe(
      "claude '--tag=two words'",
    )
  })
})

describe('commandFor — how a claude tab is made to report', () => {
  const PATHS = {
    settings: '/home/u/.config/claude-studio/agent-hooks/settings.json',
    notify: '/home/u/.config/claude-studio/agent-hooks/codex-notify.sh',
  }

  it('goes before the agent’s own arguments, so a positional prompt stays last', () => {
    expect(commandFor(agent(), tab({ agentSessionId: SID, startPrompt: 'fix it' }), PATHS)).toBe(
      `claude --settings ${PATHS.settings} --session-id ${SID} 'fix it'`,
    )
  })

  it('is added on a resume as well: /clear can happen in any run', () => {
    expect(commandFor(agent(), tab({ launched: true, agentSessionId: SID }), PATHS)).toBe(
      `claude --settings ${PATHS.settings} --resume ${SID}`,
    )
  })

  it('is left out for an agent with no conversation of its own', () => {
    // somebody else's binary: it takes neither flag, and nothing would read the answer
    expect(commandFor(agent({ sessionSource: 'none' }), tab({ agentSessionId: SID }), PATHS)).toBe(
      `claude --session-id ${SID}`,
    )
  })

  it('is left out when main could not write one — the tab starts exactly as before', () => {
    expect(commandFor(agent(), tab({ agentSessionId: SID }))).toBe(`claude --session-id ${SID}`)
  })

  it('quotes a path with spaces in it', () => {
    expect(commandFor(agent({ args: [] }), tab(), { ...PATHS, settings: '/home/my user/hooks.json' })).toBe(
      "claude --settings '/home/my user/hooks.json'",
    )
  })
})

/**
 * Codex takes no `--settings`: the notify program is a config override on the command line, and
 * its value is parsed as TOML. So the path crosses two grammars on its way in — TOML inside the
 * value, the shell outside it — and both have to hold for a path nobody chose carefully.
 */
describe('commandFor — how a codex tab is made to report', () => {
  const NOTIFY = '/home/u/.config/claude-studio/agent-hooks/codex-notify.sh'
  const paths = (notify: string): { settings: string; notify: string } => ({ settings: '/s.json', notify })
  const codex = (over: Partial<AgentDef> = {}): AgentDef =>
    agent({
      id: 'codex',
      command: 'codex',
      args: [],
      resumeArgs: ['resume', '{session}'],
      historyArgs: ['resume'],
      sessionSource: 'codex',
      ...over,
    })

  it('passes the program as a -c override, before the agent’s own arguments', () => {
    expect(commandFor(codex(), tab(), paths(NOTIFY))).toBe(`codex -c 'notify=["${NOTIFY}"]'`)
  })

  it('is added on a resume as well: a thread can be left for a new one at any time', () => {
    expect(commandFor(codex(), tab({ launched: true, agentSessionId: SID }), paths(NOTIFY))).toBe(
      `codex -c 'notify=["${NOTIFY}"]' resume ${SID}`,
    )
  })

  it('keeps a positional prompt last', () => {
    expect(commandFor(codex(), tab({ startPrompt: 'fix it' }), paths(NOTIFY))).toBe(
      `codex -c 'notify=["${NOTIFY}"]' 'fix it'`,
    )
  })

  it('survives a path with spaces: the whole override is one shell word', () => {
    const notify = '/home/my user/Application Support/claude-studio/codex-notify.sh'
    expect(commandFor(codex(), tab(), paths(notify))).toBe(`codex -c 'notify=["${notify}"]'`)
  })

  it('escapes what would end the TOML string early', () => {
    // a quote or a backslash inside a basic string is what turns a path into a parse error
    expect(commandFor(codex(), tab(), paths('/home/u/we"ird\\dir/notify.sh'))).toBe(
      `codex -c 'notify=["/home/u/we\\"ird\\\\dir/notify.sh"]'`,
    )
  })

  it('keeps the single quote of the shell and the double quote of TOML apart', () => {
    // the shell word is single-quoted, so a single quote in the path has to be closed and reopened
    expect(commandFor(codex(), tab(), paths("/home/u/o'brien/notify.sh"))).toBe(
      `codex -c 'notify=["/home/u/o'\\''brien/notify.sh"]'`,
    )
  })

  it('is left out when main could not write one — the tab starts exactly as before', () => {
    expect(commandFor(codex(), tab())).toBe('codex')
  })

  it('never gets the claude overlay', () => {
    expect(commandFor(codex(), tab(), paths(NOTIFY))).not.toContain('--settings')
  })

  /**
   * The command line is not a string we hand to codex — it is typed into a shell, which decides
   * where one argument ends. So it is asked: the same line, with `codex` replaced by a printf
   * that shows what the arguments turned out to be.
   */
  describe('as the shell splits it', () => {
    const argvOf = (command: string): string[] =>
      execFileSync('/bin/sh', ['-c', command.replace(/^codex/, `printf '%s\\n'`)], { encoding: 'utf8' })
        .split('\n')
        .slice(0, -1)

    it('hands the whole override over as one argument', () => {
      expect(argvOf(commandFor(codex(), tab(), paths(NOTIFY)) ?? '')).toEqual(['-c', `notify=["${NOTIFY}"]`])
    })

    it('does the same for the paths that would break it', () => {
      for (const notify of [
        '/home/my user/Application Support/claude-studio/codex-notify.sh',
        '/home/u/we"ird\\dir/notify.sh',
        "/home/u/o'brien/notify.sh",
        '/home/u/$HOME `whoami`/notify.sh',
      ]) {
        const command = commandFor(codex(), tab({ launched: true, agentSessionId: SID }), paths(notify)) ?? ''
        // what the shell hands over is the TOML text itself: the path, with the two characters
        // TOML would choke on escaped and nothing else touched. The resume follows it.
        const inToml = notify.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        expect(argvOf(command)).toEqual(['-c', `notify=["${inToml}"]`, 'resume', SID])
      }
    })
  })
})

describe('commandForRun', () => {
  const run = (over: Partial<AgentRun> = {}): AgentRun => ({
    id: 'r1',
    agentId: 'claude',
    title: 'old run',
    startedAt: 0,
    ...over,
  })

  it('resumes a recorded conversation', () => {
    expect(commandForRun(agent(), run({ agentSessionId: SID }))).toBe(`claude --resume ${SID}`)
  })

  it('opens the CLI picker when the run has no id', () => {
    expect(commandForRun(agent(), run())).toBe('claude --resume')
  })

  it('keeps extraArgs and quoting', () => {
    const a = agent({ extraArgs: ['--dir', '/tmp/my dir'] })
    expect(commandForRun(a, run({ agentSessionId: SID }))).toBe(`claude --resume ${SID} --dir '/tmp/my dir'`)
  })
})

describe('findAgent', () => {
  const settings = { agents: [agent(), agent({ id: 'codex', name: 'Codex' })] } as Settings

  it('finds by id', () => {
    expect(findAgent(settings, 'codex')?.name).toBe('Codex')
  })

  it('returns null for an unknown or absent id', () => {
    expect(findAgent(settings, 'nope')).toBeNull()
    expect(findAgent(settings, undefined)).toBeNull()
  })
})

describe('titleFor', () => {
  it('uses the agent name for the first tab', () => {
    expect(titleFor(agent(), [])).toBe('Claude')
  })

  it('numbers repeats', () => {
    const existing = [tab({ agentId: 'claude' })]
    expect(titleFor(agent(), existing)).toBe('Claude 2')
  })

  it('names shells "Shell" and counts them separately', () => {
    expect(titleFor(null, [])).toBe('Shell')
    expect(titleFor(null, [tab({ kind: 'shell' })])).toBe('Shell 2')
    expect(titleFor(null, [tab({ agentId: 'claude' })])).toBe('Shell')
  })
})

describe('parseEnv', () => {
  it('parses KEY=VALUE lines', () => {
    expect(parseEnv('A=1\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('skips blanks and comments', () => {
    expect(parseEnv('\n# note\nA=1\n  \n')).toEqual({ A: '1' })
  })

  it('keeps = inside the value', () => {
    expect(parseEnv('URL=https://x/?a=b')).toEqual({ URL: 'https://x/?a=b' })
  })

  it('ignores lines without a key', () => {
    expect(parseEnv('=novalue\nnoequals')).toEqual({})
  })

  it('trims around the separator', () => {
    expect(parseEnv('  A = 1  ')).toEqual({ A: '1' })
  })
})
