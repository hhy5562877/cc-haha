import { describe, expect, it } from 'vitest'
import {
  DAL_DEFAULT_THINKING_LEVEL,
  DAL_GATEWAY_MODELS,
  DAL_GATEWAY_PROVIDER_ID,
  DAL_THINKING_LEVELS,
  isDalThinkingLevel,
} from './modelCatalog'

describe('DAL model catalog constants', () => {
  it('registers the dalcode-gateway provider id used by dal --provider', () => {
    expect(DAL_GATEWAY_PROVIDER_ID).toBe('dalcode-gateway')
  })

  it('covers the full pi-agent-core ThinkingLevel range with the dal default', () => {
    expect(DAL_THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(DAL_DEFAULT_THINKING_LEVEL).toBe('medium')
  })

  it('ships no seed models — the gateway is the only source of truth', () => {
    expect(DAL_GATEWAY_MODELS).toEqual([])
  })

  it('validates thinking levels', () => {
    expect(isDalThinkingLevel('off')).toBe(true)
    expect(isDalThinkingLevel('max')).toBe(true)
    expect(isDalThinkingLevel('ultra')).toBe(false)
    expect(isDalThinkingLevel(42)).toBe(false)
  })
})
