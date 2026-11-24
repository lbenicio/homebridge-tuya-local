import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

const { crc32, encodeRequest, decodeResponse, FrameReader, readOptions } = require('../tools/sensor-lan-probe.cjs')
const localKey = 'testlocalkey0001'

function response(command: number, value?: object): Buffer {
  const encoded = value ? encodeRequest(command, 42, value, localKey) : encodeRequest(9, 42, undefined, localKey)
  const frame = Buffer.concat([encoded.subarray(0, 16), Buffer.alloc(4), encoded.subarray(16)])
  frame.writeUInt32BE(command, 8)
  frame.writeUInt32BE(frame.length - 16, 12)
  frame.writeUInt32BE(crc32(frame.subarray(0, -8)), frame.length - 8)
  return frame
}

describe('sensor LAN diagnostic', () => {
  it('matches the standard CRC32 test vector and omits the refresh protocol prefix', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    const frame = encodeRequest(18, 1, { dpId: [1, 2, 16] }, localKey)
    const decipher = crypto.createDecipheriv('aes-128-ecb', localKey, null)
    const data = JSON.parse(Buffer.concat([decipher.update(frame.subarray(16, -8)), decipher.final()]).toString())
    expect(data).toEqual({ dpId: [1, 2, 16] })
  })

  it('distinguishes empty acknowledgments, empty reports and actual measurements', () => {
    expect(decodeResponse(response(13), localKey)).toMatchObject({ acknowledgment: true, command: 13 })
    expect(decodeResponse(response(8, { dps: {} }), localKey)).toMatchObject({ dps: {} })
    expect(decodeResponse(response(8, { dps: { '1': 23, '2': 72, '3': 'high', '16': 0 } }), localKey)).toMatchObject({
      dps: { '1': 23, '2': 72, '3': 'high', '16': 0 },
    })
  })

  it('reassembles fragmented and coalesced TCP frames', () => {
    const first = response(13)
    const second = response(8, { dps: { '1': 23 } })
    const bytes = Buffer.concat([first, second])
    const reader = new FrameReader()
    expect(reader.push(bytes.subarray(0, 7))).toEqual([])
    expect(reader.push(bytes.subarray(7, first.length + 9))).toEqual([first])
    expect(reader.push(bytes.subarray(first.length + 9))).toEqual([second])
  })

  it('rejects damaged frames and excessive lengths', () => {
    const corrupted = response(8, { dps: { '1': 23 } })
    corrupted[22] ^= 1
    expect(() => decodeResponse(corrupted, localKey)).toThrow('CRC')
    const huge = response(13)
    huge.writeUInt32BE(65536, 12)
    expect(() => new FrameReader().push(huge)).toThrow('length')
  })

  it('rejects control commands and invalid datapoint selections', () => {
    expect(() => encodeRequest(7, 1, { dps: { '1': true } }, localKey)).toThrow('Unsupported')
    const base = ['--config', '-', '--device', 'Climate Sensor']
    expect(readOptions(base).commands).toEqual(['status', 'device22'])
    expect(() => readOptions([...base, '--commands', 'reset'])).toThrow('Commands')
    expect(() => readOptions([...base, '--dps', '0,256'])).toThrow('DPS')
  })
})
