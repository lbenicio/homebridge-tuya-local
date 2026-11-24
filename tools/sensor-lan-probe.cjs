const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const { parseArgs } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')

const MAX_FRAME = 65536
const COMMANDS = { 'legacy-status': 8, status: 10, device22: 13, 'query-new': 16, refresh: 18 }

function crc32(buffer) {
  let checksum = 0xffffffff
  for (const byte of buffer) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function encodeRequest(command, sequence, data, key) {
  if (![9, ...Object.values(COMMANDS)].includes(command)) throw new Error('Unsupported diagnostic command')
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  const encrypted = data ? Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]) : Buffer.alloc(0)
  const version = command === 8 || command === 13 ? Buffer.concat([Buffer.from('3.3'), Buffer.alloc(12)]) : Buffer.alloc(0)
  const frame = Buffer.alloc(24 + version.length + encrypted.length)
  frame.writeUInt32BE(0x55aa, 0)
  frame.writeUInt32BE(sequence, 4)
  frame.writeUInt32BE(command, 8)
  frame.writeUInt32BE(frame.length - 16, 12)
  version.copy(frame, 16)
  encrypted.copy(frame, 16 + version.length)
  frame.writeUInt32BE(crc32(frame.subarray(0, -8)), frame.length - 8)
  frame.writeUInt32BE(0xaa55, frame.length - 4)
  return frame
}

function decodeResponse(frame, key) {
  if (
    frame.length < 28 ||
    frame.length > MAX_FRAME ||
    frame.readUInt32BE(0) !== 0x55aa ||
    frame.readUInt32BE(12) !== frame.length - 16 ||
    frame.readUInt32BE(frame.length - 4) !== 0xaa55 ||
    frame.readUInt32BE(frame.length - 8) !== crc32(frame.subarray(0, -8))
  ) {
    throw new Error('Invalid response frame or CRC')
  }
  const result = {
    command: frame.readUInt32BE(8),
    sequence: frame.readUInt32BE(4),
    returnCode: frame.readUInt32BE(16),
  }
  let payload = frame.subarray(20, -8)
  if (payload.subarray(0, 3).toString() === '3.3' || payload.subarray(0, 3).toString() === '3.2') {
    payload = payload.subarray(15)
  }
  if (!payload.length) return { ...result, acknowledgment: true }
  let text
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null)
    text = Buffer.concat([decipher.update(payload), decipher.final()]).toString()
  } catch {
    if (payload.toString() !== 'json obj data unvalid') throw new Error('Unable to decrypt response')
    text = payload.toString()
  }
  if (text === 'json obj data unvalid') return { ...result, device22Required: true }
  if (text === 'parse data error') return { ...result, payloadError: text }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Response payload is not JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Response payload is not an object')
  return {
    ...result,
    dps: data.dps || data.data?.dps,
    reportType: data.type,
    deviceTime: data.t,
    fields: Object.keys(data),
  }
}

class FrameReader {
  pending = Buffer.alloc(0)

  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk])
    const frames = []
    while (this.pending.length >= 16) {
      if (this.pending.readUInt32BE(0) !== 0x55aa) throw new Error('Unexpected frame prefix')
      const length = this.pending.readUInt32BE(12) + 16
      if (length < 28 || length > MAX_FRAME) throw new Error('Invalid frame length')
      if (this.pending.length < length) break
      frames.push(this.pending.subarray(0, length))
      this.pending = this.pending.subarray(length)
    }
    return frames
  }
}

function readOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      device: { type: 'string' },
      dps: { type: 'string', default: '1,2,3' },
      commands: { type: 'string', default: 'status,device22' },
      'wait-ms': { type: 'string', default: '5000' },
      'listen-seconds': { type: 'string', default: '0' },
    },
  })
  if (!values.config || !values.device) throw new Error('Specify --config and --device (Homebridge device name)')
  const dps = [...new Set(values.dps.split(',').map(Number))]
  if (!dps.length || dps.some((dp) => !Number.isInteger(dp) || dp < 1 || dp > 255)) {
    throw new Error('DPS must be integer IDs from 1 to 255')
  }
  const commands = values.commands.split(',')
  if (commands.length > 30 || commands.some((command) => !Object.hasOwn(COMMANDS, command))) {
    throw new Error('Commands must be legacy-status, status, device22, refresh, or query-new (at most 30)')
  }
  const waitMs = Number(values['wait-ms'])
  const listenSeconds = Number(values['listen-seconds'])
  if (!Number.isInteger(waitMs) || waitMs < 1000 || waitMs > 30000) throw new Error('Wait must be 1000–30000 ms')
  if (!Number.isInteger(listenSeconds) || listenSeconds < 0 || listenSeconds > 300) {
    throw new Error('Listen duration must be 0–300 seconds')
  }
  return { ...values, dps, commands, waitMs, listenSeconds }
}

async function run(options) {
  const config = JSON.parse(fs.readFileSync(options.config === '-' ? 0 : options.config, 'utf8'))
  const matches = (config.platforms || []).flatMap((platform) => platform.devices || []).filter((device) => device.name === options.device)
  if (matches.length !== 1) throw new Error('Device name must match exactly one configured device')
  const device = matches[0]
  if (device.version !== '3.3') throw new Error('This diagnostic supports Tuya LAN 3.3 only')
  if (net.isIP(device.ip) !== 4) throw new Error('A fixed IPv4 address is required')
  const octets = device.ip.split('.').map(Number)
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))) {
    throw new Error('Only private LAN addresses are allowed')
  }
  if (!device.id || Buffer.byteLength(device.key || '') !== 16) throw new Error('Device ID and 16-byte local key are required')
  const requestId = typeof device.lanId === 'string' && device.lanId.trim() ? device.lanId.trim() : device.id
  const report = (record) => {
    let line = JSON.stringify({ time: new Date().toISOString(), ...record })
    for (const secret of [device.id, requestId, device.key]) line = line.split(secret).join('[redacted]')
    process.stdout.write(line + '\n')
  }
  const reader = new FrameReader()
  const socket = new net.Socket()
  let sequence = 1
  let phase = 'connect'
  let frames = 0
  let reports = 0
  let failure
  const send = (command, data) => socket.write(encodeRequest(command, sequence++, data, device.key))
  socket.on('error', (error) => {
    failure = error
  })
  socket.on('data', (chunk) => {
    try {
      for (const frame of reader.push(chunk)) {
        const response = decodeResponse(frame, device.key)
        frames++
        if (response.dps && Object.keys(response.dps).length) reports++
        report({ event: 'response', phase, ...response })
      }
    } catch (error) {
      failure = error
      socket.destroy()
    }
  })
  const connectTimer = setTimeout(() => socket.destroy(new Error('Connect timeout')), 5000)
  let heartbeat
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.connect(device.port || 6668, device.ip, resolve)
    })
    clearTimeout(connectTimer)
    heartbeat = setInterval(() => {
      if (!socket.destroyed) send(9)
    }, 9000)
    report({ event: 'connected', ip: device.ip, dps: options.dps })
    for (const command of options.commands) {
      if (failure || socket.destroyed) throw failure || new Error('Device closed the connection')
      phase = command
      const base = { devId: requestId, uid: requestId, t: String(Math.floor(Date.now() / 1000)) }
      const data = command === 'refresh' ? { dpId: options.dps } : command === 'device22' ? { ...base, dps: Object.fromEntries(options.dps.map((dp) => [dp, null])) } : command === 'status' ? { ...base, gwId: requestId } : base
      report({ event: 'request', phase, command: COMMANDS[command], sequence })
      send(COMMANDS[command], data)
      await delay(options.waitMs)
    }
    phase = 'listen'
    await delay(options.listenSeconds * 1000)
    if (failure) throw failure
    report({ event: 'complete', frames, reports })
  } finally {
    clearTimeout(connectTimer)
    clearInterval(heartbeat)
    socket.destroy()
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => run(readOptions(process.argv.slice(2))))
    .catch((error) => {
      process.stderr.write(JSON.stringify({ event: 'error', message: error.message }) + '\n')
      process.exitCode = 1
    })
}

module.exports = { crc32, encodeRequest, decodeResponse, FrameReader, readOptions }
