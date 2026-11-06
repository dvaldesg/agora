#!/usr/bin/env -S node --no-warnings
import { parseArgs } from 'node:util'
import { OPTIONS, USAGE, commands } from '../src/cli.js'

const splitPassthrough = ({ argv }) => {
  const separator = argv.indexOf('--')
  return separator === -1 ? { own: argv, extraArgs: [] } : { own: argv.slice(0, separator), extraArgs: argv.slice(separator + 1) }
}

const main = async () => {
  const { own, extraArgs } = splitPassthrough({ argv: process.argv.slice(2) })
  const { values, positionals } = parseArgs({ args: own, allowPositionals: true, allowNegative: true, options: OPTIONS })
  const [name, ...rest] = positionals
  const command = commands[name]
  if (!command || values.help) {
    console.log(USAGE)
    return
  }
  await command({ values, positionals: rest, extraArgs })
}

main().catch((error) => {
  console.error(`agora: ${error.message}`)
  process.exit(1)
})
