/**
 * The four adapters, registered.
 *
 * One file per platform, all implementing `PlatformAdapter`, so a platform
 * that changes its markup is one file to fix and the other three keep
 * working. That separation is the whole point: these break independently and
 * often, and a single shared parser would mean every rot took the service
 * down entirely.
 */

import type { Platform, PlatformAdapter } from '../types'
import { facebook } from './facebook'
import { instagram } from './instagram'
import { linkedin } from './linkedin'
import { twitter } from './twitter'

export const adapters: Record<Platform, PlatformAdapter> = {
  Facebook: facebook,
  Instagram: instagram,
  LinkedIn: linkedin,
  'Twitter/X': twitter,
}
