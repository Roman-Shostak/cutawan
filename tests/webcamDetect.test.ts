import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/main/projects', () => ({ updateProject: vi.fn() }))
const { webcamRegion } = await import('../src/main/pipeline/webcamDetect')

describe('webcamRegion', () => {
  it('turns a 0-1000 box into a source rectangle', () => {
    expect(webcamRegion({ left: 0, top: 300, right: 230, bottom: 500 })).toEqual({ x: 0, y: 0.3, width: 0.23, height: 0.2 })
  })
  it('accepts swapped corners', () => {
    expect(webcamRegion({ left: 230, top: 500, right: 0, bottom: 300 })?.width).toBeCloseTo(0.23)
  })
  it('rejects boxes too small or covering most of the frame', () => {
    expect(webcamRegion({ left: 0, top: 0, right: 30, bottom: 30 })).toBeNull()
    expect(webcamRegion({ left: 0, top: 0, right: 1000, bottom: 1000 })).toBeNull()
  })
})
