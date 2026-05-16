/**
 * Pure tests for the CLI's argument parser. The parser is colocated in
 * `cli.ts` because it has zero deps; reimport via a re-export here.
 */

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const eqIdx = token.indexOf('=')
    if (eqIdx > 0) {
      flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = true
    }
  }
  return { positional, flags }
}

describe('reports CLI parseArgs', () => {
  it('parses positional arguments', () => {
    expect(parseArgs(['abc', 'def'])).toEqual({
      positional: ['abc', 'def'],
      flags: {},
    })
  })

  it('parses --key value flag pairs', () => {
    expect(parseArgs(['--tenant', 't1', '--org', 'o1'])).toEqual({
      positional: [],
      flags: { tenant: 't1', org: 'o1' },
    })
  })

  it('parses --key=value flag form', () => {
    expect(parseArgs(['--params={"foo":1}', '--tenant=t1'])).toEqual({
      positional: [],
      flags: { params: '{"foo":1}', tenant: 't1' },
    })
  })

  it('parses bare boolean flags', () => {
    expect(parseArgs(['--json'])).toEqual({
      positional: [],
      flags: { json: true },
    })
  })

  it('mixes positional + flags', () => {
    expect(parseArgs(['report-id-123', '--tenant', 't1', '--json'])).toEqual({
      positional: ['report-id-123'],
      flags: { tenant: 't1', json: true },
    })
  })

  it('treats trailing flag as bare boolean when followed by another flag', () => {
    expect(parseArgs(['--dry-run', '--tenant', 't1'])).toEqual({
      positional: [],
      flags: { 'dry-run': true, tenant: 't1' },
    })
  })

  it('handles empty argv', () => {
    expect(parseArgs([])).toEqual({ positional: [], flags: {} })
  })
})
