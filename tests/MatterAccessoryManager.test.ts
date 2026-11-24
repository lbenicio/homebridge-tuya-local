import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import MatterAccessoryManager from '../src/MatterAccessoryManager'

function createDevice(type: string, state: Record<string, unknown> = { '1': false }) {
  const device = new EventEmitter() as EventEmitter & {
    context: Record<string, unknown>
    state: Record<string, unknown>
    update: ReturnType<typeof vi.fn>
  }
  device.context = {
    id: 'tuya-device-id',
    UUID: 'uuid-tuya-device',
    name: 'Test Device',
    type,
    key: '1234567890123456',
    ip: '192.0.2.50',
  }
  device.state = state
  device.update = vi.fn(() => true)
  return device
}

function createMatterApi() {
  return {
    deviceTypes: {
      OnOffLight: { name: 'OnOffLight' },
      OnOffOutlet: { name: 'OnOffOutlet' },
      DimmableLight: { name: 'DimmableLight' },
      ColorTemperatureLight: { name: 'ColorTemperatureLight' },
      Fan: { name: 'Fan' },
      TemperatureSensor: { name: 'TemperatureSensor' },
      ContactSensor: { name: 'ContactSensor' },
      GenericSwitch: { name: 'GenericSwitch' },
    },
    clusterNames: {
      OnOff: 'onOff',
      LevelControl: 'levelControl',
      ColorControl: 'colorControl',
      FanControl: 'fanControl',
      TemperatureMeasurement: 'temperatureMeasurement',
      RelativeHumidityMeasurement: 'relativeHumidityMeasurement',
      BooleanState: 'booleanState',
    },
    registerPlatformAccessories: vi.fn().mockResolvedValue(undefined),
    unregisterPlatformAccessories: vi.fn().mockResolvedValue(undefined),
    updateAccessoryState: vi.fn().mockResolvedValue(undefined),
  }
}

describe('MatterAccessoryManager', () => {
  it('normalizes supported types and rejects types without Matter mappings', () => {
    for (const type of ['outlet', 'SimpleDimmer', 'TWLight', 'MultiOutlet', 'CustomMultiOutlet', 'Switch', 'Fan', 'FanLight', 'TemperatureHumiditySensor', 'ContactSensor', 'WirelessSwitch']) {
      expect(MatterAccessoryManager.supportsType(type)).toBe(true)
    }
    expect(MatterAccessoryManager.supportsType(' airconditioner ')).toBe(false)
    expect(MatterAccessoryManager.supportsType(undefined)).toBe(false)
  })

  it('registers and updates a local outlet', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const device = createDevice('outlet')

    manager.add(device as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())

    device.state['1'] = true
    device.emit('change', { '1': true }, device.state)
    await vi.waitFor(() => expect(matter.updateAccessoryState).toHaveBeenCalledWith('uuid-tuya-device', 'onOff', { onOff: true }))
    expect(matter.registerPlatformAccessories).toHaveBeenCalledWith('@lbenicio/homebridge-tuya-local', 'TuyaLocalPlatform', [expect.objectContaining({ deviceType: matter.deviceTypes.OnOffOutlet })])
  })

  it('registers temperature and humidity state without a cloud dependency', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const device = createDevice('temperaturehumiditysensor', { '1': 260, '2': 68 })
    device.context.temperatureDivisor = 10

    manager.add(device as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())

    const registration = matter.registerPlatformAccessories.mock.calls[0][2][0]
    expect(registration.clusters.temperatureMeasurement.measuredValue).toBe(2600)
    expect(registration.clusters.relativeHumidityMeasurement.measuredValue).toBe(6800)
  })

  it('maps dimmer controls to power and brightness DPs', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const device = createDevice('simpledimmer', { '1': false, '2': 141 })

    manager.add(device as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())
    const registration = matter.registerPlatformAccessories.mock.calls[0][2][0]

    expect(registration.deviceType).toBe(matter.deviceTypes.DimmableLight)
    expect(registration.clusters.onOff.onOff).toBe(false)
    expect(registration.clusters.levelControl.currentLevel).toBeGreaterThan(1)
    expect(registration.getState('levelControl', 'currentLevel')).toBe(registration.clusters.levelControl.currentLevel)
    expect(registration.getState('unsupported', 'currentLevel')).toBeUndefined()

    registration.handlers.onOff.on()
    registration.handlers.onOff.toggle()
    registration.handlers.levelControl.moveToLevel({ level: 254 })
    registration.handlers.levelControl.moveToLevelWithOnOff({ level: 0 })
    registration.handlers.levelControl.moveToLevelWithOnOff({ level: 127 })

    expect(device.update).toHaveBeenCalledWith({ '1': true })
    expect(device.update).toHaveBeenCalledWith({ '1': false })
    expect(device.update).toHaveBeenCalledWith({ '1': false, '2': 255 })
    expect(device.update).toHaveBeenCalledWith({ '1': true, '2': 139 })
  })

  it('maps tunable-white lights and clamps color-temperature commands', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const device = createDevice('twlight', { '1': true, '2': 200, '3': 120 })

    manager.add(device as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())
    const registration = matter.registerPlatformAccessories.mock.calls[0][2][0]

    expect(registration.deviceType).toBe(matter.deviceTypes.ColorTemperatureLight)
    expect(registration.clusters.colorControl.colorTemperatureMireds).toBeGreaterThan(0)
    registration.handlers.levelControl.moveToLevel({ level: 0 })
    registration.handlers.levelControl.moveToLevelWithOnOff({ level: 0 })
    registration.handlers.colorControl.moveToColorTemperatureLogic({ colorTemperatureMireds: 1 })

    expect(device.update).toHaveBeenCalledWith({ '2': 25 })
    expect(device.update).toHaveBeenCalledWith({ '1': false })
    expect(device.update).toHaveBeenCalledWith({ '3': 255 })
  })

  it('updates only the changed endpoint on a multi-outlet device', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const device = createDevice('multioutlet', { '1': false, '2': true })
    device.context.outletCount = 2

    manager.add(device as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())
    const registration = matter.registerPlatformAccessories.mock.calls[0][2][0]

    expect(registration.parts).toHaveLength(1)
    expect(registration.parts[0].id).toBe('outlet-2')
    expect(registration.parts[0].clusters.onOff.onOff).toBe(true)

    device.state['2'] = false
    device.emit('change', { '2': false }, device.state)
    await vi.waitFor(() => expect(matter.updateAccessoryState).toHaveBeenCalledWith('uuid-tuya-device', 'onOff', { onOff: false }, 'outlet-2'))
  })

  it('maps fan speed modes and fans with optional light endpoints', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const fan = createDevice('fan', { '1': true, '3': '2' })
    manager.add(fan as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())

    const registration = matter.registerPlatformAccessories.mock.calls[0][2][0]
    expect(registration.deviceType).toBe(matter.deviceTypes.Fan)
    expect(registration.clusters.fanControl.percentSetting).toBe(67)
    registration.handlers.fanControl.fanModeChange({ fanMode: 0 })
    registration.handlers.fanControl.fanModeChange({ fanMode: 2 })
    registration.handlers.fanControl.percentSettingChange({ percentSetting: 0 })
    registration.handlers.fanControl.percentSettingChange({ percentSetting: 50 })
    expect(fan.update).toHaveBeenCalledWith({ '1': false, '3': '1' })
    expect(fan.update).toHaveBeenCalledWith({ '1': true, '3': '2' })

    const matterWithFreshMocks = createMatterApi()
    const fanLightManager = new MatterAccessoryManager({ matter: matterWithFreshMocks }, { warn: vi.fn(), debug: vi.fn() })
    const fanLight = createDevice('fanlight', { '1': true, '3': '2', '9': false })
    fanLightManager.add(fanLight as any)
    await vi.waitFor(() => expect(matterWithFreshMocks.registerPlatformAccessories).toHaveBeenCalledOnce())
    expect(matterWithFreshMocks.registerPlatformAccessories.mock.calls[0][2][0].parts).toHaveLength(1)

    const noLight = createDevice('fanlight', { '1': true, '3': '2' })
    noLight.context.id = 'fan-without-light'
    noLight.context.useLight = false
    fanLightManager.add(noLight as any)
    await vi.waitFor(() => expect(matterWithFreshMocks.registerPlatformAccessories).toHaveBeenCalledTimes(2))
    expect(matterWithFreshMocks.registerPlatformAccessories.mock.calls[1][2][0].parts).toBeUndefined()
  })

  it('normalizes contact-sensor polarity and emits wireless-switch gestures', async () => {
    const matter = createMatterApi()
    matter.switch = { emit: vi.fn().mockResolvedValue(undefined), emitGesture: vi.fn().mockResolvedValue(undefined) }
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const contact = createDevice('contactsensor', { '1': false })
    manager.add(contact as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())
    const contactAccessory = matter.registerPlatformAccessories.mock.calls[0][2][0]
    expect(contactAccessory.clusters.booleanState.stateValue).toBe(true)
    expect(contactAccessory.getState('booleanState', 'stateValue')).toBe(true)

    const wireless = createDevice('wirelessswitch', { '1': 'double_click' })
    wireless.context.id = 'wireless-device'
    wireless.context.switches = [{ dp: 1 }, { dp: 2 }]
    const wirelessManager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    wirelessManager.add(wireless as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledTimes(2))
    wireless.emit('change', { '1': 'double_click' }, wireless.state)
    await vi.waitFor(() => expect(matter.switch!.emitGesture).toHaveBeenCalledWith('uuid-tuya-device', 'doublePress', { position: 1 }))

    matter.switch.emitGesture = undefined
    wireless.emit('change', { '2': 'long_press' }, { '1': 'double_click', '2': 'long_press' })
    await vi.waitFor(() => expect(matter.switch!.emit).toHaveBeenCalledWith('uuid-tuya-device', 'press', { position: 2 }))
    expect(matter.switch.emit).toHaveBeenCalledWith('uuid-tuya-device', 'release', { position: 2 })
  })

  it('unregisters stale cached accessories and removes active devices', async () => {
    const matter = createMatterApi()
    const manager = new MatterAccessoryManager({ matter }, { warn: vi.fn(), debug: vi.fn() })
    const cached = { context: { deviceId: 'removed-device' }, displayName: 'Old accessory' }
    manager.configureAccessory(cached)
    await vi.waitFor(() => expect(matter.unregisterPlatformAccessories).toHaveBeenCalledWith('@lbenicio/homebridge-tuya-local', 'TuyaLocalPlatform', [cached]))

    const device = createDevice('outlet')
    manager.add(device as any)
    await vi.waitFor(() => expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce())
    manager.remove('tuya-device-id')
    await vi.waitFor(() => expect(matter.unregisterPlatformAccessories).toHaveBeenCalledTimes(2))
  })
})
