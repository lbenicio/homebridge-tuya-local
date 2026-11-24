import type { DPSState, TuyaDeviceConfig } from './types'

const PLUGIN_NAME = '@lbenicio/homebridge-tuya-local'
const PLATFORM_NAME = 'TuyaLocalPlatform'

type MatterApi = {
  deviceTypes: Record<string, any>
  clusterNames: Record<string, string>
  registerPlatformAccessories: (pluginIdentifier: string, platformName: string, accessories: any[]) => Promise<void>
  unregisterPlatformAccessories: (pluginIdentifier: string, platformName: string, accessories: any[]) => Promise<void>
  updateAccessoryState: (uuid: string, cluster: string, attributes: Record<string, unknown>, partId?: string) => Promise<void>
  switch?: {
    emit: (uuid: string, action: 'press' | 'release', options?: { position?: number }) => Promise<void>
    emitGesture?: (uuid: string, gesture: 'singlePress' | 'doublePress' | 'longPress', options?: { position?: number }) => Promise<void>
  }
}

type MatterPlatformApi = {
  matter?: MatterApi
}

type MatterDevice = {
  context: TuyaDeviceConfig & { UUID: string }
  state: DPSState
  update: (state: DPSState) => boolean
  on: (event: 'change', listener: (changes: DPSState, state: DPSState) => void) => void
  off?: (event: 'change', listener: (changes: DPSState, state: DPSState) => void) => void
}

type MatterEndpoint = {
  id?: string
  displayName: string
  deviceType: any
  dependencies: string[]
  clusters: (state: DPSState) => Record<string, Record<string, unknown>>
  handlers?: Record<string, Record<string, (...args: any[]) => void | Promise<void>>>
  getState?: (cluster: string, attribute: string) => unknown
}

type MatterRecord = {
  accessory: any
  device: MatterDevice
  endpoints: MatterEndpoint[]
  listener: (changes: DPSState, state: DPSState) => void
  registered: boolean
  removed: boolean
  retryTimer?: ReturnType<typeof setTimeout>
}

const POWER_TYPES = new Set(['outlet', 'rgbtwoutlet', 'simplelight', 'rgbtwlight', 'twlight'])
const OUTLET_TYPES = new Set(['outlet', 'rgbtwoutlet'])
const SENSOR_TYPES = new Set(['temperaturehumiditysensor', 'temperaturehumidity', 'thermometer'])
const CONTACT_TYPES = new Set(['contactsensor', 'doorsensor'])
const DIMMER_TYPES = new Set(['simpledimmer', 'simpledimmer2'])

const SUPPORTED_TYPES = new Set([...POWER_TYPES, ...DIMMER_TYPES, 'multioutlet', 'custommultioutlet', 'switch', 'fan', 'fanlight', ...SENSOR_TYPES, ...CONTACT_TYPES, 'wirelessswitch'])

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return ['true', '1', 'on', 'open', 'opened'].includes(String(value).toLowerCase().trim())
}

const numericValue = (value: unknown, fallback = 0): number => {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

export default class MatterAccessoryManager {
  private readonly accessories = new Map<string, MatterRecord>()
  private readonly cachedAccessories = new Map<string, any>()
  private expectedDeviceIds = new Set<string>()

  constructor(
    private readonly api: MatterPlatformApi,
    private readonly log: any,
  ) {}

  static supportsType(type: unknown): boolean {
    return SUPPORTED_TYPES.has(
      String(type || '')
        .trim()
        .toLowerCase(),
    )
  }

  setExpectedDeviceIds(deviceIds: Iterable<string>): void {
    this.expectedDeviceIds = new Set(deviceIds)
    for (const [deviceId, accessory] of this.cachedAccessories) {
      if (!this.expectedDeviceIds.has(deviceId)) void this.unregisterCached(deviceId, accessory)
    }
  }

  configureAccessory(accessory: any): void {
    const deviceId = accessory?.context?.deviceId
    if (typeof deviceId !== 'string' || !deviceId) return

    this.cachedAccessories.set(deviceId, accessory)
    if (!this.expectedDeviceIds.has(deviceId)) void this.unregisterCached(deviceId, accessory)
  }

  add(device: MatterDevice): void {
    const matter = this.api.matter
    if (!matter) return

    const deviceId = String(device.context.id)
    if (this.accessories.has(deviceId)) return

    const definition = this.createDefinition(matter, device)
    if (!definition) {
      this.log.info('No Matter mapping is available for %s (%s); keeping it on HomeKit only.', device.context.name || deviceId, device.context.type)
      return
    }

    const record: MatterRecord = {
      ...definition,
      device,
      registered: false,
      removed: false,
      listener: (changes, state) => {
        void this.updateState(matter, record, changes, state).catch((error: unknown) => {
          this.log.debug('Failed to update Matter accessory %s: %s', record.accessory.displayName, error)
        })
      },
    }

    this.accessories.set(deviceId, record)
    device.on('change', record.listener)
    void this.register(matter, deviceId, record)
  }

  remove(deviceId: string): void {
    const record = this.accessories.get(deviceId)
    const cached = this.cachedAccessories.get(deviceId)
    this.accessories.delete(deviceId)
    this.cachedAccessories.delete(deviceId)

    if (record) {
      record.removed = true
      if (record.retryTimer) clearTimeout(record.retryTimer)
      record.device.off?.('change', record.listener)
    }

    const accessory = record?.accessory || cached
    if (!accessory || !this.api.matter || (record && !record.registered)) return

    void this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]).catch((error: unknown) => {
      this.log.debug('Matter accessory %s could not be unregistered: %s', accessory.displayName, error)
    })
  }

  private createDefinition(matter: MatterApi, device: MatterDevice): Omit<MatterRecord, 'device' | 'listener' | 'registered' | 'removed' | 'retryTimer'> | undefined {
    const context = device.context
    const type = String(context.type || '').toLowerCase()
    const identity = {
      UUID: context.UUID,
      displayName: context.name || context.id,
      manufacturer: context.manufacturer || 'Tuya',
      model: context.model || context.type,
      // Matter controllers can read serial numbers, so publish a stable value
      // derived from the Homebridge UUID instead of the raw Tuya device ID.
      serialNumber: String(context.UUID || '')
        .replace(/[^a-f0-9]/gi, '')
        .slice(-12)
        .toUpperCase(),
      // Keep LAN keys and addresses out of the Matter accessory cache.
      context: { deviceId: String(context.id) },
    }

    let endpoints: MatterEndpoint[] | undefined
    if (DIMMER_TYPES.has(type)) endpoints = [this.createDimmableLightEndpoint(matter, device)]
    else if (type === 'twlight') endpoints = [this.createColorTemperatureLightEndpoint(matter, device)]
    else if (POWER_TYPES.has(type)) endpoints = [this.createOnOffEndpoint(matter, device, this.getPowerDp(context, type), OUTLET_TYPES.has(type) ? matter.deviceTypes.OnOffOutlet : matter.deviceTypes.OnOffLight)]
    else if (type === 'multioutlet' || type === 'custommultioutlet') endpoints = this.createMultiOutletEndpoints(matter, device, type)
    else if (type === 'switch') endpoints = this.createSwitchEndpoints(matter, device)
    else if (type === 'fan') endpoints = [this.createFanEndpoint(matter, device)]
    else if (type === 'fanlight') endpoints = this.createFanLightEndpoints(matter, device)
    else if (SENSOR_TYPES.has(type)) endpoints = this.createSensorEndpoints(matter, device)
    else if (CONTACT_TYPES.has(type)) endpoints = [this.createContactEndpoint(matter, device)]
    else if (type === 'wirelessswitch') endpoints = [this.createWirelessSwitchEndpoint(matter, device)]

    if (!endpoints?.length) return undefined

    const [root, ...parts] = endpoints
    const accessory = {
      ...identity,
      deviceType: root.deviceType,
      clusters: root.clusters(device.state),
      ...(root.handlers ? { handlers: root.handlers } : {}),
      ...(root.getState ? { getState: root.getState } : {}),
      ...(parts.length
        ? {
            parts: parts.map((part) => ({
              id: part.id,
              displayName: part.displayName,
              deviceType: part.deviceType,
              clusters: part.clusters(device.state),
              ...(part.handlers ? { handlers: part.handlers } : {}),
            })),
          }
        : {}),
    }

    return { accessory, endpoints }
  }

  private createOnOffEndpoint(matter: MatterApi, device: MatterDevice, dp: string, deviceType: any, id?: string, displayName = device.context.name || device.context.id): MatterEndpoint {
    const read = (state: DPSState): boolean => toBoolean(state[dp])
    const write = (value: boolean): void => this.write(device, { [dp]: value })

    return {
      id,
      displayName,
      deviceType,
      dependencies: [dp],
      clusters: (state) => ({ onOff: { onOff: read(state) } }),
      handlers: {
        onOff: {
          on: () => write(true),
          off: () => write(false),
          toggle: () => write(!read(device.state)),
        },
      },
      getState: (cluster, attribute) => (cluster === matter.clusterNames.OnOff && attribute === 'onOff' ? read(device.state) : undefined),
    }
  }

  private createDimmableLightEndpoint(matter: MatterApi, device: MatterDevice): MatterEndpoint {
    const context = device.context
    const powerDp = this.getDp(context.dpPower, '1')
    const brightnessDp = String(String(context.type).toLowerCase() === 'simpledimmer2' ? '3' : context.dpBrightness || context.dp || '2')
    const getLevel = (state: DPSState): number => this.tuyaBrightnessToLevel(state[brightnessDp], context)
    const updateLevel = (level: unknown, turnOn: boolean): void => {
      const matterLevel = clamp(numericValue(level, 1), 1, 254)
      const percent = ((matterLevel - 1) / 253) * 100
      this.write(device, {
        [powerDp]: turnOn,
        [brightnessDp]: this.percentToTuyaBrightness(percent, context),
      })
    }

    return {
      displayName: context.name || context.id,
      deviceType: matter.deviceTypes.DimmableLight,
      dependencies: [powerDp, brightnessDp],
      clusters: (state) => ({
        onOff: { onOff: toBoolean(state[powerDp]) },
        levelControl: { currentLevel: getLevel(state), minLevel: 1, maxLevel: 254 },
      }),
      handlers: {
        onOff: {
          on: () => this.write(device, { [powerDp]: true }),
          off: () => this.write(device, { [powerDp]: false }),
          toggle: () => this.write(device, { [powerDp]: !toBoolean(device.state[powerDp]) }),
        },
        levelControl: {
          moveToLevel: (args: { level?: number }) => updateLevel(args?.level, toBoolean(device.state[powerDp])),
          moveToLevelWithOnOff: (args: { level?: number }) => {
            if (numericValue(args?.level) <= 0) return this.write(device, { [powerDp]: false })
            updateLevel(args?.level, true)
          },
        },
      },
      getState: (cluster, attribute) => {
        if (cluster === matter.clusterNames.OnOff && attribute === 'onOff') return toBoolean(device.state[powerDp])
        if (cluster === matter.clusterNames.LevelControl && attribute === 'currentLevel') return getLevel(device.state)
        return undefined
      },
    }
  }

  private createColorTemperatureLightEndpoint(matter: MatterApi, device: MatterDevice): MatterEndpoint {
    const context = device.context
    const powerDp = this.getDp(context.dpPower, '1')
    const brightnessDp = this.getDp(context.dpBrightness, '2')
    const temperatureDp = this.getDp(context.dpColorTemperature, '3')
    const readMireds = (state: DPSState): number => this.tuyaTemperatureToMireds(state[temperatureDp], context)
    const writeMireds = (value: unknown): void => {
      this.write(device, { [temperatureDp]: this.miredsToTuyaTemperature(numericValue(value, 250), context) })
    }

    return {
      displayName: context.name || context.id,
      deviceType: matter.deviceTypes.ColorTemperatureLight,
      dependencies: [powerDp, brightnessDp, temperatureDp],
      clusters: (state) => ({
        onOff: { onOff: toBoolean(state[powerDp]) },
        levelControl: { currentLevel: this.tuyaBrightnessToLevel(state[brightnessDp], context), minLevel: 1, maxLevel: 254 },
        colorControl: {
          colorTemperatureMireds: readMireds(state),
          colorTempPhysicalMinMireds: this.whiteColorBounds(context).min,
          colorTempPhysicalMaxMireds: this.whiteColorBounds(context).max,
          colorMode: 2,
          enhancedColorMode: 2,
        },
      }),
      handlers: {
        onOff: {
          on: () => this.write(device, { [powerDp]: true }),
          off: () => this.write(device, { [powerDp]: false }),
          toggle: () => this.write(device, { [powerDp]: !toBoolean(device.state[powerDp]) }),
        },
        levelControl: {
          moveToLevel: (args: { level?: number }) => {
            const level = clamp(numericValue(args?.level, 1), 1, 254)
            this.write(device, { [brightnessDp]: this.percentToTuyaBrightness(((level - 1) / 253) * 100, context) })
          },
          moveToLevelWithOnOff: (args: { level?: number }) => {
            const level = numericValue(args?.level)
            this.write(device, {
              [powerDp]: level > 0,
              ...(level > 0 ? { [brightnessDp]: this.percentToTuyaBrightness(((clamp(level, 1, 254) - 1) / 253) * 100, context) } : {}),
            })
          },
        },
        colorControl: {
          moveToColorTemperatureLogic: (args: { colorTemperatureMireds?: number }) => writeMireds(args?.colorTemperatureMireds),
        },
      },
      getState: (cluster, attribute) => {
        if (cluster === matter.clusterNames.OnOff && attribute === 'onOff') return toBoolean(device.state[powerDp])
        if (cluster === matter.clusterNames.LevelControl && attribute === 'currentLevel') return this.tuyaBrightnessToLevel(device.state[brightnessDp], context)
        if (cluster === matter.clusterNames.ColorControl && attribute === 'colorTemperatureMireds') return readMireds(device.state)
        return undefined
      },
    }
  }

  private createMultiOutletEndpoints(matter: MatterApi, device: MatterDevice, type: string): MatterEndpoint[] {
    const configured =
      type === 'custommultioutlet' && Array.isArray(device.context.outlets)
        ? device.context.outlets.filter((outlet: any) => outlet && Number(outlet.dp) > 0).map((outlet: any) => ({ dp: String(outlet.dp), name: String(outlet.name || `Outlet ${outlet.dp}`) }))
        : Array.from({ length: clamp(Math.trunc(numericValue(device.context.outletCount, 1)) || 1, 1, 32) }, (_value, index) => ({ dp: String(index + 1), name: `Outlet ${index + 1}` }))
    const outlets = configured.length ? configured : [{ dp: '1', name: 'Outlet 1' }]
    const [first, ...rest] = outlets
    return [
      this.createOnOffEndpoint(matter, device, first.dp, matter.deviceTypes.OnOffOutlet, undefined, `${device.context.name || device.context.id} ${first.name}`),
      ...rest.map((outlet) => this.createOnOffEndpoint(matter, device, outlet.dp, matter.deviceTypes.OnOffOutlet, `outlet-${outlet.dp}`, `${device.context.name || device.context.id} ${outlet.name}`)),
    ]
  }

  private createSwitchEndpoints(matter: MatterApi, device: MatterDevice): MatterEndpoint[] {
    const count = clamp(Math.trunc(numericValue(device.context.switchCount, 1)) || 1, 1, 32)
    return Array.from({ length: count }, (_value, index) => {
      const position = index + 1
      const name = Array.isArray(device.context.switchNames) && device.context.switchNames[index] ? String(device.context.switchNames[index]) : `Switch ${position}`
      // Matter's OnOffSwitch type describes a controller (a wall switch that
      // sends commands to another node), not a relay with an on/off output.
      return this.createOnOffEndpoint(matter, device, String(position), matter.deviceTypes.OnOffOutlet, position === 1 ? undefined : `switch-${position}`, `${device.context.name || device.context.id} ${name}`)
    })
  }

  private createFanEndpoint(matter: MatterApi, device: MatterDevice, id?: string, displayName = device.context.name || device.context.id): MatterEndpoint {
    const context = device.context
    const powerDp = this.getDp(context.dpFanOn, '1')
    const speedDp = this.getDp(context.dpRotationSpeed, '3')
    const maxSpeed = clamp(Math.trunc(numericValue(context.maxSpeed, 3)) || 3, 1, 100)
    const useStrings = context.useStrings === undefined ? true : toBoolean(context.useStrings)
    const rawSpeed = (state: DPSState): number => clamp(Math.trunc(numericValue(state[speedDp], 1)), 1, maxSpeed)
    const speedPercent = (state: DPSState): number => Math.round((rawSpeed(state) / maxSpeed) * 100)
    const fanMode = (state: DPSState): number => {
      if (!toBoolean(state[powerDp])) return 0
      if (maxSpeed === 1) return 3
      if (rawSpeed(state) === 1) return 1
      if (rawSpeed(state) === maxSpeed) return 3
      return 2
    }
    const writeSpeed = (value: unknown): void => {
      const speed = clamp(Math.round((numericValue(value) / 100) * maxSpeed), 1, maxSpeed)
      this.write(device, { [powerDp]: true, [speedDp]: useStrings ? String(speed) : speed })
    }
    const writeMode = (value: unknown): void => {
      const mode = numericValue(value)
      if (mode <= 0) {
        const defaultSpeed = clamp(Math.trunc(numericValue(context.fanDefaultSpeed, 1)) || 1, 1, maxSpeed)
        this.write(device, { [powerDp]: false, [speedDp]: useStrings ? String(defaultSpeed) : defaultSpeed })
        return
      }
      const speed = mode === 1 ? 1 : mode === 2 ? Math.max(2, Math.ceil(maxSpeed / 2)) : maxSpeed
      this.write(device, { [powerDp]: true, [speedDp]: useStrings ? String(speed) : speed })
    }

    return {
      id,
      displayName,
      deviceType: matter.deviceTypes.Fan,
      dependencies: [powerDp, speedDp],
      clusters: (state) => ({
        fanControl: {
          fanMode: fanMode(state),
          fanModeSequence: maxSpeed === 1 ? 5 : maxSpeed === 2 ? 1 : 0,
          percentSetting: toBoolean(state[powerDp]) ? speedPercent(state) : null,
          percentCurrent: toBoolean(state[powerDp]) ? speedPercent(state) : 0,
        },
      }),
      handlers: {
        fanControl: {
          fanModeChange: (args: { fanMode?: number }) => writeMode(args?.fanMode),
          percentSettingChange: (args: { percentSetting?: number | null }) => {
            if (args?.percentSetting === null || numericValue(args?.percentSetting) <= 0) return writeMode(0)
            writeSpeed(args?.percentSetting)
          },
        },
      },
    }
  }

  private createFanLightEndpoints(matter: MatterApi, device: MatterDevice): MatterEndpoint[] {
    const fan = this.createFanEndpoint(matter, device)
    const useLight = device.context.useLight === undefined ? true : toBoolean(device.context.useLight)
    if (!useLight) return [fan]
    const lightDp = this.getDp(device.context.dpLightOn, '9')
    const light = this.createOnOffEndpoint(matter, device, lightDp, matter.deviceTypes.OnOffLight, 'light', `${device.context.name || device.context.id} Light`)
    return [fan, light]
  }

  private createSensorEndpoints(matter: MatterApi, device: MatterDevice): MatterEndpoint[] {
    const context = device.context
    const temperatureDp = this.getDp(context.dpTemperature, '1')
    const humidityDp = this.getDp(context.dpHumidity, '2')
    const temperatureDivisor = numericValue(context.temperatureDivisor, 1) || 1
    const humidityDivisor = numericValue(context.humidityDivisor, 1) || 1
    const temperature = (state: DPSState): number | null => this.measurement(state[temperatureDp], temperatureDivisor, -100, 100)
    const humidity = (state: DPSState): number | null => this.measurement(state[humidityDp], humidityDivisor, 0, 100)
    const temperatureEndpoint: MatterEndpoint = {
      displayName: context.name || context.id,
      deviceType: matter.deviceTypes.TemperatureSensor,
      dependencies: [temperatureDp, humidityDp],
      clusters: (state) => ({
        temperatureMeasurement: { measuredValue: this.toHundredths(temperature(state)) },
        relativeHumidityMeasurement: { measuredValue: this.toHundredths(humidity(state)) },
      }),
      getState: (cluster, attribute) => {
        if (cluster === matter.clusterNames.TemperatureMeasurement && attribute === 'measuredValue') return this.toHundredths(temperature(device.state))
        if (cluster === matter.clusterNames.RelativeHumidityMeasurement && attribute === 'measuredValue') return this.toHundredths(humidity(device.state))
        return undefined
      },
    }
    return [temperatureEndpoint]
  }

  private createContactEndpoint(matter: MatterApi, device: MatterDevice): MatterEndpoint {
    const context = device.context
    const contactDp = this.getDp(context.dpContact, '1')
    const flipState = toBoolean(context.flipState)
    // For the Matter ContactSensor type, FALSE means open/no contact and TRUE
    // means closed/contact. Tuya's raw and flipped inputs describe openness.
    const read = (state: DPSState): boolean => (flipState ? toBoolean(state[contactDp]) : !toBoolean(state[contactDp]))
    return {
      displayName: context.name || context.id,
      deviceType: matter.deviceTypes.ContactSensor,
      dependencies: [contactDp],
      clusters: (state) => ({ booleanState: { stateValue: read(state) } }),
      getState: (cluster, attribute) => (cluster === matter.clusterNames.BooleanState && attribute === 'stateValue' ? read(device.state) : undefined),
    }
  }

  private createWirelessSwitchEndpoint(matter: MatterApi, device: MatterDevice): MatterEndpoint {
    const configured =
      Array.isArray(device.context.switches) && device.context.switches.length > 0 ? device.context.switches : Array.from({ length: Math.max(1, Number(device.context.switchCount) || 3) }, (_value, index) => ({ dp: index + 1 }))
    const switches = configured.map((item: { dp?: string | number }) => String(item.dp))
    return {
      displayName: device.context.name || device.context.id,
      deviceType: matter.deviceTypes.GenericSwitch,
      dependencies: switches,
      clusters: () => ({ switch: { currentPosition: 0, numberOfPositions: switches.length } }),
    }
  }

  private async register(matter: MatterApi, deviceId: string, record: MatterRecord, attempts = 0): Promise<void> {
    if (record.removed || this.accessories.get(deviceId) !== record) return

    try {
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [record.accessory])
      if (record.removed || this.accessories.get(deviceId) !== record) {
        await matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [record.accessory])
        return
      }

      record.registered = true
      this.cachedAccessories.delete(deviceId)
    } catch (error) {
      if (attempts < 10 && !record.removed) {
        record.retryTimer = setTimeout(() => void this.register(matter, deviceId, record, attempts + 1), 1000)
        return
      }
      this.log.warn('Failed to register Matter accessory %s: %s', record.accessory.displayName, error)
      return
    }

    try {
      // Restored Matter accessories keep their cached cluster attributes. Refresh
      // them from the live LAN state after registration completes.
      await this.updateState(matter, record, {}, record.device.state, true)
    } catch (error) {
      this.log.debug('Failed to refresh Matter accessory %s after registration: %s', record.accessory.displayName, error)
    }
  }

  private async updateState(matter: MatterApi, record: MatterRecord, changes: DPSState, state: DPSState, force = false): Promise<void> {
    const type = String(record.device.context.type || '').toLowerCase()
    if (!record.registered && !force) return

    if (type === 'wirelessswitch') {
      if (!matter.switch || !Object.keys(changes).length) return
      const configured =
        Array.isArray(record.device.context.switches) && record.device.context.switches.length > 0
          ? record.device.context.switches
          : Array.from({ length: Math.max(1, Number(record.device.context.switchCount) || 3) }, (_value, index) => ({ dp: index + 1 }))
      const position = configured.findIndex((item: { dp?: string | number }) => Object.prototype.hasOwnProperty.call(changes, String(item.dp))) + 1
      if (position <= 0) return

      const value = String(changes[String(configured[position - 1].dp)] || '').toLowerCase()
      const gesture = value.includes('double') ? 'doublePress' : value.includes('long') || value.includes('hold') ? 'longPress' : 'singlePress'
      if (matter.switch.emitGesture) await matter.switch.emitGesture(record.accessory.UUID, gesture, { position })
      else {
        await matter.switch.emit(record.accessory.UUID, 'press', { position })
        await matter.switch.emit(record.accessory.UUID, 'release', { position })
      }
      return
    }

    for (const endpoint of record.endpoints) {
      if (!force && !endpoint.dependencies.some((dp) => Object.prototype.hasOwnProperty.call(changes, dp))) continue
      const partId = endpoint.id
      for (const [cluster, attributes] of Object.entries(endpoint.clusters(state))) {
        if (partId) await matter.updateAccessoryState(record.accessory.UUID, cluster, attributes, partId)
        else await matter.updateAccessoryState(record.accessory.UUID, cluster, attributes)
      }
    }
  }

  private write(device: MatterDevice, state: DPSState): void {
    if (!device.update(state)) throw new Error(`${device.context.name || device.context.id} is not connected`)
  }

  private getPowerDp(context: TuyaDeviceConfig, type = ''): string {
    if (context.dpPower || context.dp) return this.getDp(context.dpPower || context.dp, '1')
    return type === 'rgbtwoutlet' ? '101' : '1'
  }

  private getDp(value: unknown, fallback: string): string {
    return Number(value) > 0 ? String(value) : fallback
  }

  private whiteColorBounds(context: TuyaDeviceConfig): { min: number; max: number; scale: number } {
    const configuredMin = numericValue(context.minWhiteColor, 140) || 140
    const configuredMax = numericValue(context.maxWhiteColor, 400) || 400
    const min = Math.min(configuredMin, configuredMax)
    const max = Math.max(configuredMin, configuredMax)
    return { min: min === max ? 140 : min, max: min === max ? 400 : max, scale: numericValue(context.scaleWhiteColor, 255) || 255 }
  }

  private tuyaTemperatureToMireds(value: unknown, context: TuyaDeviceConfig): number {
    const { min, max, scale } = this.whiteColorBounds(context)
    const raw = clamp(numericValue(value), 0, scale)
    return Math.round(max / ((raw * (max - min)) / (scale * min) + 1))
  }

  private miredsToTuyaTemperature(value: number, context: TuyaDeviceConfig): number {
    const { min, max, scale } = this.whiteColorBounds(context)
    const mireds = clamp(value, min, max)
    return clamp(Math.round(((scale * min) / (max - min)) * (max / mireds - 1)), 0, scale)
  }

  private tuyaBrightnessToLevel(value: unknown, context: TuyaDeviceConfig): number {
    const minimum = numericValue(context.minBrightness, 27) || 27
    const scale = numericValue(context.scaleBrightness, 255) || 255
    if (scale <= minimum) return 254
    const percent = clamp(Math.round((99 * numericValue(value) - 100 * minimum + scale) / (scale - minimum)), 0, 100)
    return clamp(Math.round((percent / 100) * 253) + 1, 1, 254)
  }

  private percentToTuyaBrightness(value: number, context: TuyaDeviceConfig): number {
    const minimum = numericValue(context.minBrightness, 27) || 27
    const scale = numericValue(context.scaleBrightness, 255) || 255
    if (scale <= minimum) return scale
    return clamp(Math.round(((scale - minimum) * clamp(value, 0, 100) + 100 * minimum - scale) / 99), 0, scale)
  }

  private measurement(value: unknown, divisor: number, minimum: number, maximum: number): number | null {
    if (value === undefined || value === null || !Number.isFinite(Number(value))) return null
    return clamp(Number(value) / divisor, minimum, maximum)
  }

  private toHundredths(value: number | null): number | null {
    return value === null ? null : Math.round(value * 100)
  }

  private async unregisterCached(deviceId: string, accessory: any): Promise<void> {
    this.cachedAccessories.delete(deviceId)
    if (!this.api.matter) return
    try {
      await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    } catch (error) {
      this.log.debug('Matter accessory %s was not registered: %s', accessory.displayName, error)
    }
  }
}
