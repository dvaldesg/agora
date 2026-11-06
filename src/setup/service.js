import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { LOG_FILE } from '../config.js'
import { BIN_PATH, home, run, runOrThrow } from './system.js'

const LABEL = 'dev.agora.hub'
const PASSTHROUGH_ENV = ['AGORA_HOME', 'AGORA_PORT', 'AGORA_MAX_VERSIONS']

const escapeXml = ({ value }) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const envEntries = () => PASSTHROUGH_ENV.filter((key) => process.env[key]).map((key) => [key, process.env[key]])

const launchd = () => {
  const file = home('Library', 'LaunchAgents', `${LABEL}.plist`)
  const domain = `gui/${process.getuid()}`
  const plist = () => {
    const args = [process.execPath, BIN_PATH, 'daemon'].map((value) => `    <string>${escapeXml({ value })}</string>`).join('\n')
    const env = envEntries()
      .map(([key, value]) => `    <key>${key}</key><string>${escapeXml({ value })}</string>`)
      .join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml({ value: LOG_FILE })}</string>
  <key>StandardErrorPath</key><string>${escapeXml({ value: LOG_FILE })}</string>
</dict>
</plist>
`
  }
  return {
    name: 'launchd agent',
    file,
    isInstalled: async () => existsSync(file) && (await run({ file: 'launchctl', args: ['print', `${domain}/${LABEL}`] })).ok,
    install: async () => {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, plist())
      await run({ file: 'launchctl', args: ['bootout', `${domain}/${LABEL}`] })
      await runOrThrow({ file: 'launchctl', args: ['bootstrap', domain, file] })
    },
    uninstall: async () => {
      await run({ file: 'launchctl', args: ['bootout', `${domain}/${LABEL}`] })
      await rm(file, { force: true })
    },
  }
}

const systemd = () => {
  const file = home('.config', 'systemd', 'user', 'agora.service')
  const unit = () =>
    [
      '[Unit]',
      'Description=AGORA hub',
      '',
      '[Service]',
      `ExecStart=${process.execPath} ${BIN_PATH} daemon`,
      ...envEntries().map(([key, value]) => `Environment=${key}=${value}`),
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n')
  return {
    name: 'systemd user service',
    file,
    isInstalled: async () => (await run({ file: 'systemctl', args: ['--user', 'is-enabled', 'agora'] })).ok,
    install: async () => {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, unit())
      await runOrThrow({ file: 'systemctl', args: ['--user', 'daemon-reload'] })
      await runOrThrow({ file: 'systemctl', args: ['--user', 'enable', '--now', 'agora'] })
    },
    uninstall: async () => {
      await run({ file: 'systemctl', args: ['--user', 'disable', '--now', 'agora'] })
      await rm(file, { force: true })
    },
  }
}

const MANAGERS = { darwin: launchd, linux: systemd }

export const serviceManager = () => MANAGERS[process.platform]?.() ?? null
