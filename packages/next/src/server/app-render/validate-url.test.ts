import { validateURL } from './validate-url'

describe('validateUrl', () => {
  it('should return valid pathname', () => {
    expect(validateURL('/').pathname).toBe('/')
    expect(validateURL('/abc').pathname).toBe('/abc')
  })

  it('should throw for invalid pathname', () => {
    expect(() => validateURL('//**y/\\')).toThrow()
    expect(() => validateURL('//google.com')).toThrow()
  })
})
