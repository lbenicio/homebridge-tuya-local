import { describe, expect, it, vi } from 'vitest'
import ContactSensorAccessory from '../src/accessories/ContactSensor.accessory'
import TemperatureHumiditySensorAccessory from '../src/accessories/TemperatureHumiditySensor.accessory'
import { createMockCategories, createMockCharacteristic, createMockLogger, createMockPlatformAccessory, createMockService, createMockTuyaDevice } from './helpers'

function createPlatform() {
  const Characteristic: any = {
    ...createMockCharacteristic(),
    ContactSensorState: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
  }
  const log = createMockLogger()
  const platform = {
    log,
    api: { hap: { Characteristic, Service: createMockService(), Categories: createMockCategories() } },
    registerPlatformAccessories: vi.fn(),
  }
  return { platform, Characteristic, log }
}

describe('TemperatureHumiditySensorAccessory', () => {
  it('parses temperature and humidity with configured divisors', () => {
    const { platform } = createPlatform()
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor' } as any)
    const accessory = createMockPlatformAccessory({ name: 'Climate Sensor' })
    const sensor = new TemperatureHumiditySensorAccessory(platform, accessory, device, false)

    sensor.dpTemperature = '11'
    sensor.dpHumidity = '10'
    sensor.temperatureDivisor = 10
    sensor.humidityDivisor = 10

    expect(sensor._getTemperature(265)).toBe(26.5)
    expect(sensor._getHumidity(685)).toBe(68.5)
  })

  it('maps string battery states to HomeKit percentages', () => {
    const { platform } = createPlatform()
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor' } as any)
    const accessory = createMockPlatformAccessory({ name: 'Climate Sensor' })
    const sensor = new TemperatureHumiditySensorAccessory(platform, accessory, device, false)

    expect(sensor._getBatteryLevel('high')).toBe(100)
    expect(sensor._getBatteryLevel('middle')).toBe(50)
    expect(sensor._getBatteryLevel('low')).toBe(10)
  })

  it('maps CO readings using the configured divisor', () => {
    const { platform } = createPlatform()
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor' } as any)
    const accessory = createMockPlatformAccessory({ name: 'CO Sensor' })
    const sensor = new TemperatureHumiditySensorAccessory(platform, accessory, device, false)

    sensor.dpCarbonMonoxide = '3'
    sensor.carbonMonoxideDivisor = 10

    expect(sensor._getCarbonMonoxideLevel(25)).toBe(2.5)
    expect(sensor._getCarbonMonoxideLevel(0)).toBe(0)
  })

  it('creates the CO service before the first device report', () => {
    const { platform } = createPlatform()
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor', dpCarbonMonoxide: 3 } as any)
    const accessory = createMockPlatformAccessory({ name: 'CO Sensor' })
    const sensor = new TemperatureHumiditySensorAccessory(platform, accessory, device, false)

    sensor._registerPlatformAccessory()
    sensor._registerCharacteristics({})

    expect(accessory.services.some((service: any) => service.displayName === 'Test Device CO')).toBe(true)
  })

  it.each(['high', '', ' ', null, false, {}, -1])('rejects invalid CO data instead of reporting zero: %s', async (value) => {
    const { platform } = createPlatform()
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor', dpCarbonMonoxide: 16 } as any)
    const accessory = createMockPlatformAccessory({ name: 'Climate Sensor' })
    const sensor = new TemperatureHumiditySensorAccessory(platform, accessory, device, false)
    sensor.dpCarbonMonoxide = '16'
    sensor.carbonMonoxideDivisor = 1
    device.connected = true
    device.state = { '16': value }
    await new Promise<void>((resolve) =>
      sensor.getCarbonMonoxideLevel((error, reading) => {
        expect(error).toBeInstanceOf(Error)
        expect(reading).toBeUndefined()
        resolve()
      }),
    )
  })

  it('marks invalid CO reports unavailable and accepts a subsequent genuine zero reading', () => {
    const { platform, Characteristic } = createPlatform()
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor', dpCarbonMonoxide: 16 } as any)
    const accessory = createMockPlatformAccessory({ name: 'Climate Sensor' })
    const sensor = new TemperatureHumiditySensorAccessory(platform, accessory, device, false)
    sensor._registerPlatformAccessory()
    sensor._registerCharacteristics({ '1': 23, '2': 72, '16': 2 })
    const level = sensor.carbonMonoxideSensor.getCharacteristic(Characteristic.CarbonMonoxideLevel)
    device.emit('change', { '16': 'high' }, { '16': 'high' })
    expect(level.value).toBeInstanceOf(Error)
    expect(sensor.carbonMonoxidePeakLevel).toBe(2)
    device.emit('change', { '16': 0 }, { '16': 0 })
    expect(level.value).toBe(0)
  })

  it.each(['legacy', 'current'])('adds the configured %s battery service to a cached sensor accessory', (api) => {
    const { platform } = createPlatform()
    const { Service } = platform.api.hap
    if (api === 'current') {
      Object.assign(Service, { Battery: Service.BatteryService })
      delete Service.BatteryService
    }
    const device = createMockTuyaDevice({ type: 'temperaturehumiditysensor', dpBattery: 3 } as any)
    const accessory = createMockPlatformAccessory({ name: 'Climate Sensor' })
    new TemperatureHumiditySensorAccessory(platform, accessory, device, false)
    expect(accessory.services.some((service: any) => service.displayName === 'Test Device Battery')).toBe(true)
  })
})

describe('ContactSensorAccessory', () => {
  it('maps an open Tuya contact to HomeKit not detected', () => {
    const { platform, Characteristic } = createPlatform()
    const device = createMockTuyaDevice({ type: 'contactsensor' } as any)
    const accessory = createMockPlatformAccessory({ name: 'Door Sensor' })
    const sensor = new ContactSensorAccessory(platform, accessory, device, false)

    sensor.flipState = false

    expect(sensor._getContactState(false)).toBe(Characteristic.ContactSensorState.CONTACT_DETECTED)
    expect(sensor._getContactState(true)).toBe(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
  })

  it('supports inverted contact state and numeric battery levels', () => {
    const { platform } = createPlatform()
    const device = createMockTuyaDevice({ type: 'contactsensor' } as any)
    const accessory = createMockPlatformAccessory({ name: 'Door Sensor' })
    const sensor = new ContactSensorAccessory(platform, accessory, device, false)

    sensor.flipState = true

    expect(sensor._getContactState(false)).toBe(1)
    expect(sensor._getBatteryLevel(85)).toBe(85)
  })
})
