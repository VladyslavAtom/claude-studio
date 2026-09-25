import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from '../src/main/urls'

/**
 * The gate between an agent's output and the desktop. Terminal text is clickable and none of it
 * is ours, so what this lets through is handed to whatever handler the system has registered for
 * the scheme. A false answer costs a link that does not open; a wrong true one runs a program.
 */
describe('isSafeExternalUrl', () => {
  it('lets ordinary web links out', () => {
    expect(isSafeExternalUrl('https://example.com/a?b=1#c')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:5173/')).toBe(true)
  })

  it('refuses every other scheme, however plausible', () => {
    for (const url of [
      'file:///etc/passwd',
      'vscode://file/etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ms-msdt:/id',
      'about:blank',
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false)
    }
  })

  it('refuses what is not an address at all', () => {
    expect(isSafeExternalUrl('example.com')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })

  // the check is on the scheme, not on the text: a link may say anything before the colon
  it('is not fooled by a safe scheme appearing later in the string', () => {
    expect(isSafeExternalUrl('javascript:void("https://example.com")')).toBe(false)
  })
})
