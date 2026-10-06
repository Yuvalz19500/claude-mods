import type { ClientModule } from 'claude-code'

/** What the hooks module hands a ticket card: everything it draws, as plain data. */
export type CardProps = {
  id: string
  ref: string
  type: string
  /** The title, already wrapped to the card's width: the card's height is known before it draws. */
  lines: string[]
  status: string
  color: string
  glyph: string
  after: string
  isClosed: boolean
  width: number
}

type CardState = { isHover: boolean }

/**
 * One ticket card, drawn by a surface module so the whole card is one target:
 * a click anywhere on it, or Enter while it has the focus, posts `{ open }`
 * to the hooks module, and the pointer over it lights the whole card.
 */
const TicketCard: ClientModule<CardProps, CardState> = (p, surface) => {
  const { Box, Text } = surface.elements
  const isHover = surface.state?.isHover ?? false

  // Set on every draw (each call replaces the last), so a handler never holds stale props.
  surface.onPointer(e => {
    if (e.type === 'enter' && !isHover) surface.setState({ isHover: true })
    if (e.type === 'leave' && isHover) surface.setState({ isHover: false })
    // Before the first layout the region's size is 0: a click then is taken as inside.
    const isLaidOut = surface.columns > 0 && surface.rows > 0
    const isInside = e.x >= 0 && e.y >= 0 && (!isLaidOut || (e.x < surface.columns && e.y < surface.rows))
    if (e.type === 'up' && e.button === 'left' && isInside) surface.post({ open: p.id })
  })
  surface.onKey(e => {
    if (e.key === 'return' || e.key === ' ') surface.post({ open: p.id })
  })

  const isDim = p.isClosed && !isHover
  return (
    <Box flexDirection="column" width={p.width} borderStyle="round" borderColor={p.color} borderDimColor={isDim} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Text color={p.color}>{p.glyph}</Text>
          <Text bold dimColor={isDim}>
            {p.ref}
          </Text>
          {p.type ? <Text dimColor>{p.type}</Text> : ''}
        </Box>
        <Text color={p.isClosed ? undefined : p.color} dimColor={p.isClosed}>
          {p.status}
        </Text>
      </Box>
      {p.lines.map(line => (
        <Text dimColor={isDim} underline={isHover} wrap="truncate-end">
          {line}
        </Text>
      ))}
      {p.after ? <Text dimColor>{p.after}</Text> : ''}
    </Box>
  )
}

export default TicketCard
