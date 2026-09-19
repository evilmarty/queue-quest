export const CREDIT_EMOJI = ['❤️', '🍺', '🌯', '🥃', '🍦'] as const

export const CREDIT_EMOJI_LABELS: Record<string, string> = {
  '❤️': 'love',
  '🍺': 'beer',
  '🌯': 'burritos',
  '🥃': 'whisky',
  '🍦': 'ice cream',
}

// Emoji glyphs are font-rendered, so `image-rendering: pixelated` cannot
// affect them. Painting each glyph into a deliberately tiny canvas and letting
// CSS upscale it with nearest-neighbour sampling is what actually produces the
// chunky pixel-art look.
const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

export function drawPixelEmoji(
  canvas: HTMLCanvasElement,
  emoji: string,
): void {
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  const { width, height } = canvas

  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = false
  context.font = `${height}px ${EMOJI_FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(emoji, width / 2, height / 2, width)
}

export interface CreditCycle {
  stop(): void
}

/**
 * Cycles the credit emoji in step with its bounce animation so the glyph only
 * ever swaps when the sprite is resting at the bottom of a bounce.
 */
export function startCreditCycle(canvas: HTMLCanvasElement): CreditCycle {
  let index = 0

  const paint = (): void => {
    const emoji = CREDIT_EMOJI[index]

    drawPixelEmoji(canvas, emoji)
    canvas.setAttribute('aria-label', CREDIT_EMOJI_LABELS[emoji] ?? emoji)
  }

  const advance = (): void => {
    index = (index + 1) % CREDIT_EMOJI.length
    paint()
  }

  paint()
  canvas.addEventListener('animationiteration', advance)

  return {
    stop(): void {
      canvas.removeEventListener('animationiteration', advance)
    },
  }
}
