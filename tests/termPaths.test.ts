import { describe, expect, it } from 'vitest'
import { fileUrlToPath, findPaths, normalizePath, resolvePath } from '../src/renderer/src/lib/termPaths'
import type { PathCandidate } from '../src/renderer/src/lib/termPaths'

/**
 * The matcher is the half of terminal path links that can be wrong quietly: an over-eager rule
 * underlines half a sentence, a shy one leaves the path an agent just printed as plain text, and
 * neither shows up as an error anywhere. Every case below is something that appears in the
 * output of the CLIs this application runs.
 *
 * What is deliberately *not* tested here is whether a path exists — that is the filesystem's
 * answer, it is what keeps `and/or` from becoming a link, and it lives in `termLinks.ts`.
 */

/** the paths of a line, as `path` / `path:line` / `path:line:col`, in the order they appear */
function paths(text: string): string[] {
  return findPaths(text).map((c) =>
    c.line === undefined ? c.path : c.column === undefined ? `${c.path}:${c.line}` : `${c.path}:${c.line}:${c.column}`,
  )
}

/** the one candidate a line was expected to have */
function only(text: string): PathCandidate {
  const found = findPaths(text)
  expect(found).toHaveLength(1)
  return found[0] as PathCandidate
}

describe('findPaths — the shapes that must be found', () => {
  it('an absolute path', () => {
    expect(paths('written to /tmp/claude-1000/x/scratchpad/fe-message-14076.md')).toEqual([
      '/tmp/claude-1000/x/scratchpad/fe-message-14076.md',
    ])
  })

  it('a path relative to the tab’s directory', () => {
    expect(paths('see src/main/git.ts for the wrapper')).toEqual(['src/main/git.ts'])
  })

  it('a bare file name with an extension', () => {
    expect(paths('edited package.json')).toEqual(['package.json'])
  })

  it('the home directory', () => {
    expect(paths('config is in ~/.config/claude-studio/state.json')).toEqual(['~/.config/claude-studio/state.json'])
  })

  it('./ and ../', () => {
    expect(paths('./tools/run.sh and ../shared/types.ts')).toEqual(['./tools/run.sh', '../shared/types.ts'])
  })

  it('a line number, and a line with a column', () => {
    expect(paths('src/main/git.ts:42')).toEqual(['src/main/git.ts:42'])
    expect(paths('src/main/git.ts:42:7')).toEqual(['src/main/git.ts:42:7'])
  })

  it('the @-reference both CLIs write, without taking the @ into the link', () => {
    const found = only('@src/lib/jwt.ts:20 please')
    expect(found.path).toBe('src/lib/jwt.ts')
    expect(found.line).toBe(20)
    expect(found.text).toBe('src/lib/jwt.ts:20')
    expect(found.start).toBe(1)
  })

  it('two paths where one is a prefix of the other stay two paths', () => {
    expect(paths('src/main/git.ts and src/main/git.ts.bak')).toEqual(['src/main/git.ts', 'src/main/git.ts.bak'])
  })

  it('the range covers the path and nothing else', () => {
    const text = 'see src/main/git.ts:42, then stop'
    const found = only(text)
    expect(text.slice(found.start, found.end)).toBe('src/main/git.ts:42')
  })
})

describe('findPaths — the punctuation that is not part of the name', () => {
  it('a full stop that ends the sentence', () => {
    expect(paths('it is in src/main/git.ts.')).toEqual(['src/main/git.ts'])
    expect(paths('it is in src/main/git.ts:42.')).toEqual(['src/main/git.ts:42'])
  })

  it('a comma, a semicolon, a colon and a question mark', () => {
    expect(paths('"src/main/git.ts", next')).toEqual(['src/main/git.ts'])
    expect(paths('src/main/git.ts; src/main/pty.ts')).toEqual(['src/main/git.ts', 'src/main/pty.ts'])
    expect(paths('files: src/main/git.ts: gone')).toEqual(['src/main/git.ts'])
    expect(paths('is it src/main/git.ts?')).toEqual(['src/main/git.ts'])
  })

  it('quotes of all three kinds', () => {
    expect(paths('`src/main/git.ts`')).toEqual(['src/main/git.ts'])
    expect(paths("'src/main/git.ts'")).toEqual(['src/main/git.ts'])
    expect(paths('"src/main/git.ts"')).toEqual(['src/main/git.ts'])
  })

  it('brackets of all three kinds', () => {
    expect(paths('(src/main/git.ts)')).toEqual(['src/main/git.ts'])
    expect(paths('[src/main/git.ts]')).toEqual(['src/main/git.ts'])
    expect(paths('{src/main/git.ts}')).toEqual(['src/main/git.ts'])
  })

  it('the value of an option, without the option', () => {
    expect(paths('--out=build/app.js')).toEqual(['build/app.js'])
  })
})

describe('findPaths — what is refused', () => {
  it('a URL: those belong to the web links addon, which is asked first', () => {
    expect(paths('https://example.com/a/b.txt')).toEqual([])
    expect(paths('see http://localhost:5173/index.html now')).toEqual([])
  })

  it('an option', () => {
    expect(paths('run with --config and -v')).toEqual([])
  })

  it('a word with neither a slash nor an extension', () => {
    expect(paths('Makefile and README')).toEqual([])
  })

  it('a version or any other number with a dot in it', () => {
    expect(paths('version 1.5 and 2.10.3')).toEqual([])
  })

  it('an ssh remote and anything else with a colon left in it', () => {
    expect(paths('git@github.com:user/repo.git')).toEqual([])
    expect(paths('ext::sh -c payload')).toEqual([])
  })

  it('a string with nothing nameable in it', () => {
    expect(paths('/ // ... ..')).toEqual([])
  })

  it('a naked line number without a file', () => {
    expect(paths('at :42 of the output')).toEqual([])
  })
})

describe('findPaths — what is left to the filesystem on purpose', () => {
  // The shape test cannot tell these from a real path, and a rule strict enough to reject them
  // would reject real paths too. They become candidates; `stat` is what refuses them.
  it('prose that happens to contain a slash', () => {
    expect(paths('and/or')).toEqual(['and/or'])
    expect(paths('n/a')).toEqual(['n/a'])
  })

  it('a path-shaped thing that is a real path, just not a file', () => {
    expect(paths('/usr/bin/env python')).toEqual(['/usr/bin/env'])
  })
})

describe('resolvePath', () => {
  const cwd = '/home/u/project'

  it('an absolute path is itself', () => {
    expect(resolvePath('/tmp/x/a.md', cwd, '/home/u')).toBe('/tmp/x/a.md')
  })

  it('a relative path hangs off the tab’s directory', () => {
    expect(resolvePath('src/main/git.ts', cwd, '/home/u')).toBe('/home/u/project/src/main/git.ts')
    expect(resolvePath('./src/main/git.ts', cwd, '/home/u')).toBe('/home/u/project/src/main/git.ts')
    expect(resolvePath('../other/a.ts', cwd, '/home/u')).toBe('/home/u/other/a.ts')
  })

  it('`~` needs the home directory and refuses to guess without one', () => {
    expect(resolvePath('~/.config/x.json', cwd, '/home/u')).toBe('/home/u/.config/x.json')
    expect(resolvePath('~', cwd, '/home/u')).toBe('/home/u')
    expect(resolvePath('~/.config/x.json', cwd, null)).toBeNull()
  })

  it('a relative path with no directory to resolve against is refused', () => {
    expect(resolvePath('src/a.ts', '', '/home/u')).toBeNull()
  })
})

describe('normalizePath', () => {
  it('collapses repeated slashes and drops `.`', () => {
    expect(normalizePath('/a//b/./c')).toBe('/a/b/c')
  })

  it('resolves `..`, and stops at the root rather than climbing past it', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c')
    expect(normalizePath('/../../a')).toBe('/a')
  })

  it('keeps a trailing name and drops a trailing slash', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b')
  })
})

/**
 * `file://` links come from an agent marking a file up as an OSC 8 hyperlink. They are opened in
 * the application, not handed to the desktop — so what this returns decides which of the two
 * routes a click takes, and a wrong answer sends a local path out to the browser.
 */
describe('fileUrlToPath', () => {
  it('reads the path out of a local file link', () => {
    expect(fileUrlToPath('file:///home/bv/notes.md')).toBe('/home/bv/notes.md')
  })

  it('accepts the empty host and localhost, which both mean this machine', () => {
    expect(fileUrlToPath('file:///etc/hosts')).toBe('/etc/hosts')
    expect(fileUrlToPath('file://localhost/etc/hosts')).toBe('/etc/hosts')
  })

  // `file://elsewhere/etc/passwd` is a path on another machine; opening it as if it were ours
  // would name a local file that has nothing to do with the link
  it('refuses a link to another host', () => {
    expect(fileUrlToPath('file://elsewhere/etc/passwd')).toBeNull()
  })

  it('refuses everything that is not a file link', () => {
    expect(fileUrlToPath('https://example.com/a')).toBeNull()
    expect(fileUrlToPath('vscode://file/tmp/a')).toBeNull()
    expect(fileUrlToPath('not a url at all')).toBeNull()
  })

  it('decodes the escapes a URI puts in a name', () => {
    expect(fileUrlToPath('file:///home/bv/my%20notes.md')).toBe('/home/bv/my notes.md')
  })

  // a lone `%` is not an escape and `decodeURIComponent` throws on it: no link beats a crash
  it('refuses a broken escape rather than throwing', () => {
    expect(fileUrlToPath('file:///home/bv/100%')).toBeNull()
  })

  it('normalises what it returns, as the rest of the matcher does', () => {
    expect(fileUrlToPath('file:///home/bv/../bv/./notes.md')).toBe('/home/bv/notes.md')
  })
})
