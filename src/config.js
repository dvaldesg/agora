import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = process.env.AGORA_HOME ?? join(homedir(), '.agora')
export const PORT = Number(process.env.AGORA_PORT ?? 4747)
export const BASE_URL = process.env.AGORA_URL ?? `http://127.0.0.1:${PORT}`
export const MAX_VERSIONS = Number(process.env.AGORA_MAX_VERSIONS ?? 50)
export const DB_FILE = join(DATA_DIR, 'agora.db')
export const TOKEN_FILE = join(DATA_DIR, 'share-token')
export const LOG_FILE = join(DATA_DIR, 'daemon.log')
export const SESSIONS_DIR = join(DATA_DIR, 'sessions')
