import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { StartInstancesCommand, StopInstancesCommand, RebootInstancesCommand } from '@aws-sdk/client-ec2'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-ec2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-ec2')>()
  return { ...actual, EC2Client: class { send = send } }
})

import { handler } from '../src/handler'

const invoke = (body: string | null) => handler({ body } as APIGatewayProxyEvent, {} as Context, () => {}) as Promise<{ statusCode: number, body: string }>
const json = (value: unknown) => JSON.stringify(value)

describe('EC2 lifecycle handler', () => {
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['start', StartInstancesCommand],
    ['stop', StopInstancesCommand],
    ['reboot', RebootInstancesCommand]
  ])('%s sends the appropriate command and returns the requested instance', async (action, Command) => {
    const result = await invoke(json({ action, instanceId: 'i-123' }))
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ success: true, action, instanceId: 'i-123' })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toBeInstanceOf(Command)
    expect(send.mock.calls[0][0].input).toEqual({ InstanceIds: ['i-123'] })
  })

  it.each([
    ['missing body', null], ['empty body', ''], ['empty object', '{}'],
    ['missing action', json({ instanceId: 'i-123' })],
    ['missing instance', json({ action: 'start' })],
    ['empty action', json({ action: '', instanceId: 'i-123' })],
    ['empty instance', json({ action: 'start', instanceId: '' })],
    ['false action', json({ action: false, instanceId: 'i-123' })],
    ['zero instance', json({ action: 'start', instanceId: 0 })]
  ])('rejects %s without calling EC2', async (_description, body) => {
    const result = await invoke(body)
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body)).toEqual({ error: 'action and instanceId are required' })
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['terminate', 'START', ' start '])('rejects unknown action %s', async (action) => {
    const result = await invoke(json({ action, instanceId: 'i-123' }))
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body)).toEqual({ error: `Unknown action: ${action}` })
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['{', 'null'])('handles invalid or unusable JSON body %s', async (body) => {
    const result = await invoke(body)
    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body)).toEqual({ error: 'Internal server error in manageEC2Instances' })
    expect(send).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledOnce()
  })

  it.each(['start', 'stop', 'reboot'])('handles an SDK failure during %s', async (action) => {
    send.mockRejectedValueOnce(new Error('EC2 unavailable'))
    const result = await invoke(json({ action, instanceId: 'i-123' }))
    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body)).toEqual({ error: 'Internal server error in manageEC2Instances' })
    expect(send).toHaveBeenCalledOnce()
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('does not log sensitive request data on successful and rejected requests', async () => {
    const secret = 'private-token-123'
    await invoke(json({ action: 'start', instanceId: 'i-123', token: secret }))
    await invoke(json({ instanceId: 'i-123', token: secret }))
    for (const method of [console.log, console.warn, console.error]) {
      expect(JSON.stringify(vi.mocked(method).mock.calls)).not.toContain(secret)
    }
  })

  it('does not log sensitive information contained in SDK errors', async () => {
    const secret = 'private-token-123'
    send.mockRejectedValueOnce(new Error(`credential: ${secret}`))
    await invoke(json({ action: 'start', instanceId: 'i-123' }))
    for (const method of [console.log, console.warn, console.error]) {
      expect(vi.mocked(method).mock.calls.flat().map(String).join(' ')).not.toContain(secret)
    }
  })
})
