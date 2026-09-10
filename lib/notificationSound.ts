// path: lib/notificationSound.ts

// A short two-note chime, synthesised with the Web Audio API rather than
// loaded from an mp3.
//
// No file to host, no format fallbacks, nothing that can 404 after a deploy,
// and it costs a few hundred bytes instead of a network request. The trade
// is that it's a plain tone rather than a designed sound — fine for "a lead
// came in", wrong if you ever want something branded, at which point swap
// the body of play() for an <audio> element.

const STORAGE_KEY = 'cc-notification-sound'

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false
  // Default on. Someone who doesn't want it turns it off once; defaulting to
  // silent would mean most people never discover the feature exists.
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setSoundEnabled(on: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
}

// One AudioContext reused for the life of the tab. Browsers cap how many a
// page may create, and a new one per chime hits that ceiling within a busy
// afternoon.
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

// Browsers refuse to play audio until the user has interacted with the page,
// leaving the context "suspended". Resuming on the first click means the
// chime works from then on; the very first notification after a cold load
// may be silent, which is the browser's rule and not something to work
// around.
export function primeSound(): void {
  const audio = getContext()
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {})
}

export function playNotificationSound(): void {
  if (!isSoundEnabled()) return
  const audio = getContext()
  if (!audio || audio.state !== 'running') return

  // Two quick notes rather than one: a single beep reads as an error sound
  // in most software, a rising pair reads as "something arrived".
  const now = audio.currentTime
  ;[
    { freq: 660, at: 0 },
    { freq: 880, at: 0.12 },
  ].forEach(({ freq, at }) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq

    // Faded in and out over the note. A square-edged tone clicks audibly at
    // the start and end, which sounds broken through laptop speakers.
    gain.gain.setValueAtTime(0, now + at)
    gain.gain.linearRampToValueAtTime(0.18, now + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.18)

    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(now + at)
    osc.stop(now + at + 0.2)
  })
}
