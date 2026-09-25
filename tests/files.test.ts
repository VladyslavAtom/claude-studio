import { describe, expect, it, vi } from 'vitest'

// the module is pure path work for what is under test; electron is never reached
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }))

const { imageMimeFor } = await import('../src/main/files')

/**
 * What the editor shows instead of editing. The extension decides, because the file is opened by
 * a person who clicked that name — a sniffed type would only disagree with it.
 */
describe('imageMimeFor', () => {
  it('names the type of the formats a tab can paint', () => {
    expect(imageMimeFor('/tmp/lights_after.png')).toBe('image/png')
    expect(imageMimeFor('/a/b/photo.JPG')).toBe('image/jpeg')
    expect(imageMimeFor('shot.jpeg')).toBe('image/jpeg')
    expect(imageMimeFor('anim.gif')).toBe('image/gif')
    expect(imageMimeFor('pic.webp')).toBe('image/webp')
    expect(imageMimeFor('pic.avif')).toBe('image/avif')
    expect(imageMimeFor('icon.ico')).toBe('image/x-icon')
  })

  it('leaves SVG to the editor: it is source, and showing it would take editing away', () => {
    expect(imageMimeFor('logo.svg')).toBeNull()
  })

  it('is not fooled by a name that merely contains a format', () => {
    expect(imageMimeFor('png')).toBeNull()
    expect(imageMimeFor('notes.png.txt')).toBeNull()
    expect(imageMimeFor('/home/me/.png')).toBeNull()
    expect(imageMimeFor('/tmp/png/report')).toBeNull()
  })
})
