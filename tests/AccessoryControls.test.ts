import { describe, expect, it, vi } from 'vitest'
import AirConditionerAccessory from '../src/accessories/AirConditioner.accessory'
import AirPurifierAccessory from '../src/accessories/AirPurifier.accessory'
import ConvectorAccessory from '../src/accessories/Convector.accessory'
import CustomMultiOutletAccessory from '../src/accessories/CustomMultiOutlet.accessory'
import MultiOutletAccessory from '../src/accessories/MultiOutlet.accessory'
import RGBTWLightAccessory from '../src/accessories/RGBTWLight.accessory'
import SimpleHeaterAccessory from '../src/accessories/SimpleHeater.accessory'
import SimpleDimmerAccessory from '../src/accessories/SimpleDimmer.accessory'
import SimpleFanAccessory from '../src/accessories/SimpleFan.accessory'
import SimpleFanLightAccessory from '../src/accessories/SimpleFanLight.accessory'
import TWLightAccessory from '../src/accessories/TWLight.accessory'
import { createMockCategories, createMockCharacteristic, createMockLogger, createMockPlatformAccessory, createMockService, createMockTuyaDevice } from './helpers'

function createAccessory(AccessoryClass: any, type: string, state: Record<string, any>, contextOverrides = {}, characteristicOverrides = {}) {
  const device = createMockTuyaDevice({ name: 'Test Device', type, ...contextOverrides } as any)
  device.state = state

  const accessory = createMockPlatformAccessory({ name: 'Test Device' })
  const platform = {
    log: createMockLogger(),
    api: {
      hap: {
        Characteristic: { ...createMockCharacteristic(), ...characteristicOverrides },
        Service: createMockService(),
        Categories: createMockCategories(),
      },
    },
    registerPlatformAccessories: vi.fn(),
  }

  const instance = new AccessoryClass(platform, accessory, device, false)
  instance._registerPlatformAccessory()
  instance._registerCharacteristics(state)

  return { instance, device, accessory, platform }
}

describe('accessory controls', () => {
  it('maps fan state and speed, and writes the configured string DPs', async () => {
    const { instance: fan, device, accessory, platform } = createAccessory(SimpleFanAccessory, 'fan', { '1': false, '3': '2' })
    const service = accessory.getService(platform.api.hap.Service.Fan)
    const power = service.getCharacteristic(platform.api.hap.Characteristic.On)
    const speed = service.getCharacteristic(platform.api.hap.Characteristic.RotationSpeed)

    expect(power.value).toBe(false)
    expect(speed.value).toBe(67)

    device.state = { '1': true, '3': '3' }
    device.emit('change', { '1': true, '3': '3' }, device.state)
    expect(power.value).toBe(true)
    expect(speed.value).toBe(100)

    device.connected = true
    const callback = vi.fn()
    fan.setSpeed(0, callback)
    expect(device.update).toHaveBeenCalledWith({ '1': false, '3': '1' })
    expect(callback).toHaveBeenCalledWith(null)

    const actualSpeed = await new Promise<number>((resolve, reject) => {
      fan.getSpeed((error, value) => (error ? reject(error) : resolve(value as number)))
    })
    expect(actualSpeed).toBe(100)
  })

  it('maps dimmer power and brightness and writes converted brightness', () => {
    const { instance: dimmer, device, accessory, platform } = createAccessory(SimpleDimmerAccessory, 'simpledimmer', { '1': true, '2': 141 })
    const service = accessory.getService(platform.api.hap.Service.Lightbulb)
    const power = service.getCharacteristic(platform.api.hap.Characteristic.On)
    const brightness = service.getCharacteristic(platform.api.hap.Characteristic.Brightness)

    expect(power.value).toBe(true)
    expect(brightness.value).toBe(dimmer.convertBrightnessFromTuyaToHomeKit(141))

    device.state = { '1': false, '2': 200 }
    device.emit('change', device.state, device.state)
    expect(power.value).toBe(false)
    expect(brightness.value).toBe(dimmer.convertBrightnessFromTuyaToHomeKit(200))

    device.connected = true
    const callback = vi.fn()
    dimmer.setBrightness(50, callback)
    expect(device.update).toHaveBeenCalledWith({ '2': dimmer.convertBrightnessFromHomeKitToTuya(50) })
    expect(callback).toHaveBeenCalledWith(null)
  })

  it('maps tunable-white state and ignores the HomeKit zero-temperature sentinel', () => {
    const { instance: light, device, accessory, platform } = createAccessory(TWLightAccessory, 'twlight', { '1': true, '2': 200, '3': 180 })
    const service = accessory.getService(platform.api.hap.Service.Lightbulb)
    const power = service.getCharacteristic(platform.api.hap.Characteristic.On)
    const brightness = service.getCharacteristic(platform.api.hap.Characteristic.Brightness)
    const colorTemperature = service.getCharacteristic(platform.api.hap.Characteristic.ColorTemperature)

    expect(power.value).toBe(true)
    expect(brightness.value).toBe(light.convertBrightnessFromTuyaToHomeKit(200))
    expect(colorTemperature.value).toBe(light.convertColorTemperatureFromTuyaToHomeKit(180))

    device.state = { '1': false, '2': 220, '3': 160 }
    device.emit('change', device.state, device.state)
    expect(power.value).toBe(false)
    expect(brightness.value).toBe(light.convertBrightnessFromTuyaToHomeKit(220))
    expect(colorTemperature.value).toBe(light.convertColorTemperatureFromTuyaToHomeKit(160))

    const callback = vi.fn()
    light.setColorTemperature(0, callback)
    expect(callback).toHaveBeenCalledWith(null, true)
    expect(device.update).not.toHaveBeenCalled()

    device.connected = true
    light.setColorTemperature(300, callback)
    expect(device.update).toHaveBeenCalledWith({ '3': light.convertColorTemperatureFromHomeKitToTuya(300) })
  })

  it('keeps fan and light states independent and supports optional brightness', () => {
    const { instance: fanLight, device, accessory, platform } = createAccessory(SimpleFanLightAccessory, 'fanlight', { '1': false, '3': '1', '9': true, '10': 60 }, { useBrightness: true })
    const fanService = accessory.getService(platform.api.hap.Service.Fan)
    const lightService = accessory.getService(platform.api.hap.Service.Lightbulb)
    const fanPower = fanService.getCharacteristic(platform.api.hap.Characteristic.On)
    const lightPower = lightService.getCharacteristic(platform.api.hap.Characteristic.On)
    const brightness = lightService.getCharacteristic(platform.api.hap.Characteristic.Brightness)

    expect(fanPower.value).toBe(false)
    expect(lightPower.value).toBe(true)
    expect(brightness.value).toBe(60)

    device.state = { '1': true, '3': '2', '9': false, '10': 80 }
    device.emit('change', device.state, device.state)
    expect(fanPower.value).toBe(true)
    expect(lightPower.value).toBe(false)
    expect(brightness.value).toBe(80)

    device.connected = true
    const callback = vi.fn()
    fanLight.setLightOn(true, callback)
    expect(device.update).toHaveBeenCalledWith({ '9': true })
    expect(callback).toHaveBeenCalledWith(null)
  })

  it('registers multi-outlet services and batches rapid power changes', async () => {
    vi.useFakeTimers()
    try {
      const { device, accessory, platform } = createAccessory(MultiOutletAccessory, 'multioutlet', { '1': false, '2': false }, { outletCount: 2 })
      const service1 = accessory.getServiceByUUIDAndSubType(platform.api.hap.Service.Outlet, 'outlet 1')
      const service2 = accessory.getServiceByUUIDAndSubType(platform.api.hap.Service.Outlet, 'outlet 2')
      const power1 = service1.getCharacteristic(platform.api.hap.Characteristic.On)
      const power2 = service2.getCharacteristic(platform.api.hap.Characteristic.On)

      expect(power1.value).toBe(false)
      expect(power2.value).toBe(false)

      device.connected = true
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      power1.emit('set', true, callback1)
      power2.emit('set', true, callback2)
      await vi.advanceTimersByTimeAsync(500)

      expect(device.update).toHaveBeenCalledWith({ '1': true })
      expect(device.update).toHaveBeenCalledWith({ '2': true })
      expect(callback1).toHaveBeenCalledWith(null)
      expect(callback2).toHaveBeenCalledWith(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps configured custom outlets to their own DPs and names', () => {
    const outlets = [
      { name: 'Pump', dp: 7 },
      { name: 'Heater', dp: 8 },
    ]
    const { device, accessory, platform } = createAccessory(CustomMultiOutletAccessory, 'custommultioutlet', { '7': true, '8': false }, { outlets })
    const pump = accessory.getServiceByUUIDAndSubType(platform.api.hap.Service.Outlet, 'outlet 7')
    const heater = accessory.getServiceByUUIDAndSubType(platform.api.hap.Service.Outlet, 'outlet 8')

    expect(pump.displayName).toBe('Pump - Test Device')
    expect(pump.getCharacteristic(platform.api.hap.Characteristic.On).value).toBe(true)
    expect(heater.getCharacteristic(platform.api.hap.Characteristic.On).value).toBe(false)

    device.state = { '7': true, '8': true }
    device.emit('change', { '8': true }, device.state)
    expect(heater.getCharacteristic(platform.api.hap.Characteristic.On).value).toBe(true)
  })

  it('updates air-conditioner state and writes valid HomeKit controls to Tuya DPs', () => {
    const characteristicOverrides = {
      Active: { ACTIVE: 1, INACTIVE: 0 },
      CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
      TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2 },
      LockPhysicalControls: { CONTROL_LOCK_DISABLED: 0, CONTROL_LOCK_ENABLED: 1 },
      TemperatureDisplayUnits: { CELSIUS: 0, FAHRENHEIT: 1 },
      SwingMode: { UUID: 'swing-mode', SWING_DISABLED: 0, SWING_ENABLED: 1 },
    }
    const state = { '1': true, '2': 25, '3': 22, '4': 'COOL', '5': '2', '6': false, '19': 'C', '104': true }
    const { instance: airConditioner, device, accessory, platform } = createAccessory(AirConditionerAccessory, 'airconditioner', state, {}, characteristicOverrides)
    const service = accessory.getService(platform.api.hap.Service.HeaterCooler)
    const characteristic = platform.api.hap.Characteristic

    expect(service.getCharacteristic(characteristic.CurrentHeaterCoolerState).value).toBe(characteristic.CurrentHeaterCoolerState.COOLING)
    expect(service.getCharacteristic(characteristic.TargetHeaterCoolerState).value).toBe(characteristic.TargetHeaterCoolerState.COOL)
    expect(service.getCharacteristic(characteristic.CurrentTemperature).value).toBe(22)

    const changes = { '1': false, '2': 26, '3': 24, '4': 'HEAT', '5': '3', '6': true, '19': 'F', '104': false }
    device.state = changes
    device.emit('change', changes, changes)

    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.INACTIVE)
    expect(service.getCharacteristic(characteristic.TargetHeaterCoolerState).value).toBe(characteristic.TargetHeaterCoolerState.HEAT)
    expect(service.getCharacteristic(characteristic.CurrentHeaterCoolerState).value).toBe(characteristic.CurrentHeaterCoolerState.INACTIVE)
    expect(service.getCharacteristic(characteristic.CurrentTemperature).value).toBe(24)
    expect(service.getCharacteristic(characteristic.LockPhysicalControls).value).toBe(characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED)
    expect(service.getCharacteristic(characteristic.SwingMode).value).toBe(characteristic.SwingMode.SWING_DISABLED)
    expect(service.getCharacteristic(characteristic.TemperatureDisplayUnits).value).toBe(characteristic.TemperatureDisplayUnits.FAHRENHEIT)

    device.connected = true
    const callback = vi.fn()
    airConditioner.setTargetHeaterCoolerState(characteristic.TargetHeaterCoolerState.COOL, callback)
    expect(device.update).toHaveBeenCalledWith({ '4': 'COOL' })
    expect(callback).toHaveBeenCalledWith(null)

    airConditioner.setLockPhysicalControls(characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED, callback)
    expect(device.update).toHaveBeenCalledWith({ '6': false })

    airConditioner.setTemperatureDisplayUnits(characteristic.TemperatureDisplayUnits.CELSIUS, callback)
    expect(device.update).toHaveBeenCalledWith({ '19': 'C' })
  })

  it('maps simple heater temperature readings and converts threshold writes', () => {
    const characteristicOverrides = {
      Active: { ACTIVE: 1, INACTIVE: 0 },
      CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
      TargetHeaterCoolerState: { HEAT: 1 },
    }
    const {
      instance: heater,
      device,
      accessory,
      platform,
    } = createAccessory(SimpleHeaterAccessory, 'simpleheater', { '1': true, '2': 22, '3': 21, '4': 20 }, { dpAmbientTemperature: '4', ambientTemperatureDivisor: 1 }, characteristicOverrides)
    const service = accessory.getService(platform.api.hap.Service.HeaterCooler)
    const characteristic = platform.api.hap.Characteristic
    const ambientService = accessory.getService(platform.api.hap.Service.TemperatureSensor)

    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.ACTIVE)
    expect(service.getCharacteristic(characteristic.CurrentTemperature).value).toBe(21)
    expect(service.getCharacteristic(characteristic.HeatingThresholdTemperature).value).toBe(22)
    expect(ambientService.getCharacteristic(characteristic.CurrentTemperature).value).toBe(20)

    const changes = { '1': false, '2': 23, '3': 22, '4': 21 }
    device.state = changes
    device.emit('change', changes, changes)
    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.INACTIVE)
    expect(service.getCharacteristic(characteristic.CurrentTemperature).value).toBe(22)
    expect(service.getCharacteristic(characteristic.HeatingThresholdTemperature).value).toBe(23)
    expect(ambientService.getCharacteristic(characteristic.CurrentTemperature).value).toBe(21)

    device.connected = true
    const callback = vi.fn()
    heater.setTargetThresholdTemperature(25, callback)
    expect(device.update).toHaveBeenCalledWith({ '2': 25 })
    expect(service.getCharacteristic(characteristic.HeatingThresholdTemperature).value).toBe(25)
    expect(callback).toHaveBeenCalledWith()
  })

  it('maps air-purifier controls, vendor quality levels, and optional quality sensor state', () => {
    const characteristicOverrides = {
      Active: { ACTIVE: 1, INACTIVE: 0 },
      AirQuality: { UNKNOWN: 0, EXCELLENT: 1, GOOD: 2, FAIR: 3, INFERIOR: 4, POOR: 5 },
      CurrentAirPurifierState: { INACTIVE: 0, PURIFYING_AIR: 2 },
      TargetAirPurifierState: { MANUAL: 0, AUTO: 1 },
      LockPhysicalControls: { CONTROL_LOCK_DISABLED: 0, CONTROL_LOCK_ENABLED: 1 },
    }
    const state = { '1': true, '2': 35, '3': 'manual', '4': 'low', '7': false, '22': 'good' }
    const { instance: purifier, device, accessory, platform } = createAccessory(AirPurifierAccessory, 'airpurifier', state, { manufacturer: 'Breville', noRotationSpeed: true, showAirQuality: true }, characteristicOverrides)
    const service = accessory.getService(platform.api.hap.Service.AirPurifier)
    const qualityService = accessory.getService(platform.api.hap.Service.AirQualitySensor)
    const characteristic = platform.api.hap.Characteristic

    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.ACTIVE)
    expect(service.getCharacteristic(characteristic.TargetAirPurifierState).value).toBe(characteristic.TargetAirPurifierState.MANUAL)
    expect(qualityService.getCharacteristic(characteristic.AirQuality).value).toBe(characteristic.AirQuality.GOOD)
    expect(qualityService.getCharacteristic(characteristic.PM2_5Density).value).toBe(35)

    const changes = { '1': false, '2': 120, '3': 'auto', '4': 'auto', '7': true, '22': 'great' }
    device.state = changes
    device.emit('change', changes, changes)

    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.INACTIVE)
    expect(service.getCharacteristic(characteristic.TargetAirPurifierState).value).toBe(characteristic.TargetAirPurifierState.AUTO)
    expect(service.getCharacteristic(characteristic.LockPhysicalControls).value).toBe(characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED)
    expect(qualityService.getCharacteristic(characteristic.AirQuality).value).toBe(characteristic.AirQuality.EXCELLENT)
    expect(qualityService.getCharacteristic(characteristic.PM2_5Density).value).toBe(120)

    device.connected = true
    const callback = vi.fn()
    purifier.setTargetAirPurifierState(characteristic.TargetAirPurifierState.MANUAL, callback)
    expect(device.update).toHaveBeenCalledWith({ '3': 'manual' })
    purifier.setActive(characteristic.Active.ACTIVE, callback)
    expect(device.update).toHaveBeenCalledWith({ '1': true })
    purifier.setLockPhysicalControls(characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED, callback)
    expect(device.update).toHaveBeenCalledWith({ '7': false })
  })

  it('maps convector heat, temperature units, child lock, and fan-speed controls', () => {
    const characteristicOverrides = {
      Active: { ACTIVE: 1, INACTIVE: 0 },
      CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
      TargetHeaterCoolerState: { HEAT: 1 },
      LockPhysicalControls: { CONTROL_LOCK_DISABLED: 0, CONTROL_LOCK_ENABLED: 1 },
      TemperatureDisplayUnits: { CELSIUS: 0, FAHRENHEIT: 1 },
    }
    const state = { '7': true, '2': 22, '3': 21, '4': 'LOW', '6': false, '19': 'C' }
    const { instance: convector, device, accessory, platform } = createAccessory(ConvectorAccessory, 'convector', state, { enableFlipSpeedSlider: true }, characteristicOverrides)
    const service = accessory.getService(platform.api.hap.Service.HeaterCooler)
    const characteristic = platform.api.hap.Characteristic

    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.ACTIVE)
    expect(service.getCharacteristic(characteristic.CurrentHeaterCoolerState).value).toBe(characteristic.CurrentHeaterCoolerState.HEATING)
    expect(service.getCharacteristic(characteristic.RotationSpeed).value).toBe(1)

    const changes = { '7': false, '2': 23, '3': 22, '4': 'HIGH', '6': true, '19': 'F' }
    device.state = changes
    device.emit('change', changes, changes)
    expect(service.getCharacteristic(characteristic.Active).value).toBe(characteristic.Active.INACTIVE)
    expect(service.getCharacteristic(characteristic.HeatingThresholdTemperature).value).toBe(23)
    expect(service.getCharacteristic(characteristic.CurrentTemperature).value).toBe(22)
    expect(service.getCharacteristic(characteristic.LockPhysicalControls).value).toBe(characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED)
    expect(service.getCharacteristic(characteristic.TemperatureDisplayUnits).value).toBe(characteristic.TemperatureDisplayUnits.FAHRENHEIT)

    device.connected = true
    const callback = vi.fn()
    convector.setTargetThresholdTemperature(24, callback)
    expect(device.update).toHaveBeenCalledWith({ '2': 24 })
    convector.setTemperatureDisplayUnits(characteristic.TemperatureDisplayUnits.CELSIUS, callback)
    expect(device.update).toHaveBeenCalledWith({ '19': 'C' })
    convector.setLockPhysicalControls(characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED, callback)
    expect(device.update).toHaveBeenCalledWith({ '6': false })
    device.state['4'] = 'LOW'
    convector.setRotationSpeed(100, callback)
    expect(device.update).toHaveBeenCalledWith({ '7': true })
    expect(device.update).toHaveBeenCalledWith({ '4': 'HIGH' })
  })

  it('maps RGB and white-light controls and batches color changes', async () => {
    vi.useFakeTimers()
    try {
      const state = { '1': true, '2': 'white', '3': 200, '4': 150, '5': 'ff00000000ffff' }
      const { instance: light, device, accessory, platform } = createAccessory(RGBTWLightAccessory, 'rgbtwlight', state)
      const service = accessory.getService(platform.api.hap.Service.Lightbulb)
      const characteristic = platform.api.hap.Characteristic
      const brightness = service.getCharacteristic(characteristic.Brightness)
      const hue = service.getCharacteristic(characteristic.Hue)
      const saturation = service.getCharacteristic(characteristic.Saturation)
      const colorTemperature = service.getCharacteristic(characteristic.ColorTemperature)

      expect(light.colorFunction).toBe('HEXHSB')
      expect(brightness.value).toBe(light.convertBrightnessFromTuyaToHomeKit(200))
      expect(colorTemperature.value).toBe(light.convertColorTemperatureFromTuyaToHomeKit(150))
      expect(hue.value).toBe(0)
      expect(saturation.value).toBe(0)

      device.state = { ...state, '3': 220, '4': 130 }
      device.emit('change', { '3': 220, '4': 130 }, device.state)
      expect(brightness.value).toBe(light.convertBrightnessFromTuyaToHomeKit(220))
      expect(colorTemperature.value).toBe(light.convertColorTemperatureFromTuyaToHomeKit(130))

      device.connected = true
      const callback = vi.fn()
      light.setColorTemperature(300, callback)
      expect(device.update).toHaveBeenCalledWith({ '4': light.convertColorTemperatureFromHomeKitToTuya(300) })

      light.setHue(120, callback)
      light.setSaturation(50, callback)
      await vi.advanceTimersByTimeAsync(500)
      expect(device.update).toHaveBeenCalledWith({ '2': 'colour' })
      expect(device.update).toHaveBeenCalledWith({ '5': expect.any(String) })
      expect(colorTemperature.value).toBe(0)

      const colorState = { ...device.state, '2': 'colour', '5': '00ff0000aaffff' }
      device.state = colorState
      device.emit('change', { '2': 'colour', '5': colorState['5'] }, colorState)
      expect(hue.value).not.toBe(120)
    } finally {
      vi.useRealTimers()
    }
  })
})
