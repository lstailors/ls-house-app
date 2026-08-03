import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@ls/api-client'
import { cn } from "@ls/design/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@ls/design/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ls/design/ui/select"
import { Input } from "@ls/design/ui/input"
import { Button } from "@ls/design/ui/button"
import { Label } from "@ls/design/ui/label"

// ── Types ──────────────────────────────────────────────────────────────────

interface Preset {
  id: string
  preset_name: string
  price: number
  est_minutes: number | null
  garment_types: string[]
}

interface Garment {
  garment_id: string
  garment_type: string
  garment_description: string
  color: string
}

interface Line {
  garment_ref: string
  description: string
  price: number
  preset?: string | null
  notes?: string
  estimated_minutes?: number
  /** ERP child row name — helps /full preserve photos/status */
  erpName?: string
  client_line_key?: string | null
  /** Done/Ready lines are locked in the editor (SPEC 014) */
  line_status?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketName: string
  origin?: "NYC" | string
  initialGarments: Array<{
    name: string
    garment_id: string
    garment_type: string
    garment_description: string
    color?: string
  }>
  initialLines: Array<{
    name: string
    garment_ref: string
    description: string
    price: number
    preset?: string | null
    line_notes?: string | null
    notes?: string | null
    estimated_minutes?: number | null
    est_minutes?: number | null
    client_line_key?: string | null
    line_status?: string | null
  }>
}

const GARMENT_TYPES = [
  'Jacket', 'Pants', 'Vest', 'Shirt', 'Suit',
  'Coat', 'Dress', 'Skirt', 'Blouse', 'Other',
]

let _idCounter = 1
function uid() {
  return `new-${_idCounter++}`
}

function mapInitialLines(
  initialLines: Props['initialLines'],
): Array<Line & { _key: string }> {
  return initialLines.map((l) => ({
    _key: l.name || uid(),
    erpName: l.name,
    garment_ref: l.garment_ref,
    description: l.description,
    price: l.price,
    preset: l.preset ?? null,
    notes: l.line_notes || l.notes || '',
    estimated_minutes: Number(l.estimated_minutes ?? l.est_minutes) || 15,
    client_line_key: l.client_line_key ?? null,
    line_status: l.line_status ?? 'Pending',
  }))
}

function isLineLocked(status?: string | null) {
  const s = (status || '').toLowerCase()
  return s === 'done' || s === 'ready' || s === 'complete' || s === 'completed'
}

// ── Component ──────────────────────────────────────────────────────────────

export function EditTicketDrawer({
  open,
  onOpenChange,
  ticketName,
  initialGarments,
  initialLines,
  origin = "NYC",
}: Props) {
  const queryClient = useQueryClient()
  const presetOrigin = "NYC"

  const { data: presets = [] } = useQuery<Preset[]>({
    queryKey: ['presets', presetOrigin],
    queryFn: () => api.get<Preset[]>(`/api/intake-alterations/presets?origin=${presetOrigin}`),
    staleTime: 5 * 60 * 1000,
  })

  const [garments, setGarments] = useState<Array<Garment & { _key: string }>>(() =>
    initialGarments.map((g) => ({
      _key: g.name || uid(),
      garment_id: g.garment_id,
      garment_type: g.garment_type,
      garment_description: g.garment_description,
      color: g.color ?? '',
    }))
  )

  const [lines, setLines] = useState<Array<Line & { _key: string }>>(() =>
    mapInitialLines(initialLines)
  )

  // Reset state when drawer opens with fresh data
  function handleOpenChange(val: boolean) {
    if (val) {
      setGarments(
        initialGarments.map((g) => ({
          _key: g.name || uid(),
          garment_id: g.garment_id,
          garment_type: g.garment_type,
          garment_description: g.garment_description,
          color: g.color ?? '',
        }))
      )
      setLines(mapInitialLines(initialLines))
    }
    onOpenChange(val)
  }

  // ── Garment helpers ────────────────────────────────────────────────────

  function nextGarmentId(list: Array<{ garment_id: string }>) {
    let max = 0
    for (const g of list) {
      const m = /^G(\d+)$/i.exec(String(g.garment_id || '').trim())
      if (m) max = Math.max(max, Number(m[1]) || 0)
    }
    return `G${max + 1}`
  }

  function addGarment() {
    const id = nextGarmentId(garments)
    setGarments((prev) => [
      ...prev,
      {
        _key: uid(),
        garment_id: id,
        garment_type: 'Jacket',
        garment_description: 'Jacket',
        color: '',
      },
    ])
  }

  function removeGarment(key: string) {
    const g = garments.find((x) => x._key === key)
    if (g) {
      setLines((prev) => prev.filter((l) => l.garment_ref !== g.garment_id))
    }
    setGarments((prev) => prev.filter((x) => x._key !== key))
  }

  function updateGarment(key: string, field: keyof Garment, value: string) {
    setGarments((prev) =>
      prev.map((g) => {
        if (g._key !== key) return g
        if (field === 'garment_id') {
          // Also update garment_ref on all lines belonging to this garment
          const oldId = g.garment_id
          setLines((prevLines) =>
            prevLines.map((l) =>
              l.garment_ref === oldId ? { ...l, garment_ref: value } : l
            )
          )
        }
        return { ...g, [field]: value }
      })
    )
  }

  // ── Preset helpers ──────────────────────────────────────────────────────

  function presetsForGarment(garmentType: string) {
    return presets.filter(
      (p) => p.garment_types.length === 0 || p.garment_types.includes(garmentType)
    )
  }

  function isPresetActive(garmentId: string, preset: Preset) {
    return lines.some(
      (l) =>
        l.garment_ref === garmentId &&
        (l.preset === preset.id || l.description === preset.preset_name)
    )
  }

  function togglePreset(garmentId: string, preset: Preset) {
    const existing = lines.find(
      (l) =>
        l.garment_ref === garmentId &&
        (l.preset === preset.id || l.description === preset.preset_name)
    )
    if (existing) {
      if (isLineLocked(existing.line_status)) {
        toast.error('Finished lines are locked — use Add work for new lines only')
        return
      }
      setLines((prev) => prev.filter((l) => l._key !== existing._key))
    } else {
      setLines((prev) => [
        ...prev,
        {
          _key: uid(),
          garment_ref: garmentId,
          description: preset.preset_name,
          price: preset.price,
          preset: preset.id,
          notes: '',
          estimated_minutes: preset.est_minutes || 15,
          line_status: 'Pending',
        },
      ])
    }
  }

  // ── Line helpers ────────────────────────────────────────────────────────

  function addLine(garmentId: string) {
    setLines((prev) => [
      ...prev,
      {
        _key: uid(),
        garment_ref: garmentId,
        description: '',
        price: 0,
        preset: null,
        notes: '',
        estimated_minutes: 15,
        line_status: 'Pending',
      },
    ])
  }

  function removeLine(key: string) {
    const line = lines.find((l) => l._key === key)
    if (line && isLineLocked(line.line_status)) {
      toast.error('Finished lines are locked')
      return
    }
    setLines((prev) => prev.filter((l) => l._key !== key))
  }

  function updateLine(key: string, field: keyof Line, value: string | number | null) {
    setLines((prev) =>
      prev.map((l) => {
        if (l._key !== key) return l
        if (isLineLocked(l.line_status)) return l
        return { ...l, [field]: value }
      })
    )
  }

  // ── Save ────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.raw(`/api/alterations/${encodeURIComponent(ticketName)}/full`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          garments: garments.map(({ _key: _k, ...g }) => ({
            ...g,
            garment_description: g.garment_description || g.garment_type,
          })),
          lines: lines.map(({ _key: _k, erpName, notes, ...l }) => ({
            ...l,
            name: erpName,
            line_notes: notes || null,
            estimated_minutes: l.estimated_minutes || 15,
            line_status: l.line_status || 'Pending',
          })),
        }),
      })
      const body = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        const msg =
          body?.error?.message ||
          (typeof body?.error === 'string' ? body.error : null) ||
          'Could not save ticket'
        throw new Error(typeof msg === 'string' ? msg : 'Could not save ticket')
      }
      return body
    },
    onSuccess: () => {
      toast.success('Ticket updated — pieces & prices saved')
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
      queryClient.invalidateQueries({ queryKey: ['shop-floor-tickets'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to save changes'),
  })

  // Block save if any unlocked custom line has price <= 0 with empty desc handled below
  const invalidOpenLine = lines.some(
    (l) => !isLineLocked(l.line_status) && (!(l.price > 0) || !String(l.description || '').trim()),
  )

  const total = lines.reduce((s, l) => s + (l.price || 0), 0)

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-forest-deep border-brass/20 text-cream overflow-y-auto p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-brass/10">
          <SheetTitle className="text-brass-shimmer text-lg font-bold tracking-wide">
            Edit Ticket
          </SheetTitle>
          <p className="text-cream-dim text-xs mt-0.5">{ticketName}</p>
        </SheetHeader>

        <div className="px-5 py-5 space-y-6">
          {garments.length === 0 ? (
            <p className="text-cream-dim/50 text-sm italic text-center py-4">
              No garments — add one below
            </p>
          ) : null}

          {garments.map((g) => {
            const gLines = lines.filter((l) => l.garment_ref === g.garment_id)

            return (
              <div
                key={g._key}
                className="rounded-lg border border-brass/15 bg-forest-raised"
              >
                {/* Garment header */}
                <div className="px-4 pt-4 pb-3 border-b border-brass/10 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-brass-light text-xs font-semibold uppercase tracking-wider">
                      Garment
                    </span>
                    <button
                      type="button"
                      onClick={() => removeGarment(g._key)}
                      className="p-1 rounded text-cream-dim/40 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-cream-dim text-xs">Type</Label>
                      <Select
                        value={g.garment_type}
                        onValueChange={(v) => updateGarment(g._key, 'garment_type', v)}
                      >
                        <SelectTrigger className="bg-forest-deep border-brass/20 text-cream text-sm h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-forest-raised border-brass/20 text-cream">
                          {GARMENT_TYPES.map((t) => (
                            <SelectItem key={t} value={t} className="text-cream hover:bg-brass/10">
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-cream-dim text-xs">Color</Label>
                      <Input
                        value={g.color}
                        onChange={(e) => updateGarment(g._key, 'color', e.target.value)}
                        placeholder="e.g. Navy"
                        className="bg-forest-deep border-brass/20 text-cream placeholder:text-cream-dim/30 h-8 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-cream-dim text-xs">Description</Label>
                    <Input
                      value={g.garment_description}
                      onChange={(e) => updateGarment(g._key, 'garment_description', e.target.value)}
                      placeholder="e.g. Navy wool suit jacket"
                      className="bg-forest-deep border-brass/20 text-cream placeholder:text-cream-dim/30 h-8 text-sm"
                    />
                  </div>
                </div>

                {/* Lines */}
                <div className="px-4 py-3 space-y-2">
                  {gLines.length === 0 ? (
                    <p className="text-cream-dim/40 text-xs italic">No alteration lines</p>
                  ) : null}

                  {gLines.map((l) => {
                    const locked = isLineLocked(l.line_status)
                    return (
                    <div key={l._key} className={cn('space-y-1.5', locked && 'opacity-60')}>
                      {locked && (
                        <div className="text-[10px] uppercase tracking-wider text-cream-dim">
                          Finished · locked
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Input
                          value={l.description}
                          disabled={locked}
                          onChange={(e) => updateLine(l._key, 'description', e.target.value)}
                          placeholder="e.g. Shorten sleeves"
                          className="flex-1 bg-forest-deep border-brass/20 text-cream placeholder:text-cream-dim/30 h-8 text-sm disabled:opacity-70"
                        />
                        <div className="relative w-24 shrink-0">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-dim/50 text-xs pointer-events-none">
                            $
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={locked}
                            value={l.price === 0 ? '' : l.price}
                            onChange={(e) =>
                              updateLine(l._key, 'price', parseFloat(e.target.value) || 0)
                            }
                            placeholder="0"
                            className="pl-5 bg-forest-deep border-brass/20 text-cream placeholder:text-cream-dim/30 h-8 text-sm disabled:opacity-70"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => removeLine(l._key)}
                          className="p-1 rounded text-cream-dim/30 hover:text-red-400 hover:bg-red-900/20 transition-colors shrink-0 disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 pl-0.5">
                        <Input
                          value={l.notes || ''}
                          disabled={locked}
                          onChange={(e) => updateLine(l._key, 'notes', e.target.value)}
                          placeholder="Line notes"
                          className="flex-1 bg-forest-deep border-brass/15 text-cream placeholder:text-cream-dim/25 h-7 text-xs disabled:opacity-70"
                        />
                        <div className="relative w-16 shrink-0">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            disabled={locked}
                            value={l.estimated_minutes || ''}
                            onChange={(e) =>
                              updateLine(l._key, 'estimated_minutes', parseInt(e.target.value, 10) || 15)
                            }
                            placeholder="min"
                            className="bg-forest-deep border-brass/15 text-cream placeholder:text-cream-dim/25 h-7 text-xs pr-7 disabled:opacity-70"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-cream-dim/40 text-[10px] pointer-events-none">
                            m
                          </span>
                        </div>
                      </div>
                    </div>
                    )
                  })}

                  {/* Preset chips */}
                  {presetsForGarment(g.garment_type).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {presetsForGarment(g.garment_type).map((preset) => {
                        const active = isPresetActive(g.garment_id, preset)
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => togglePreset(g.garment_id, preset)}
                            className={cn(
                              'px-2 py-0.5 rounded-full text-xs border transition-all',
                              active
                                ? 'bg-brass-shimmer/25 border-brass/60 text-brass-light font-medium'
                                : 'bg-transparent border-brass/20 text-cream-dim/60 hover:border-brass/40 hover:text-cream-dim'
                            )}
                          >
                            {preset.preset_name}
                            {active ? null : (
                              <span className="ml-1 text-cream-dim/40">
                                ${preset.price}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => addLine(g.garment_id)}
                    className="flex items-center gap-1.5 text-xs text-brass-light/70 hover:text-brass-light transition-colors mt-1"
                  >
                    <Plus size={12} />
                    Add line
                  </button>
                </div>
              </div>
            )
          })}

          {/* Add garment */}
          <button
            type="button"
            onClick={addGarment}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm',
              'border border-dashed border-brass/25 text-cream-dim/60',
              'hover:border-brass/50 hover:text-cream-dim transition-all'
            )}
          >
            <Plus size={14} />
            Add garment
          </button>

          {/* Total + Save */}
          <div className="pt-2 border-t border-brass/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-cream-dim text-sm">Estimated total</span>
              <span className="text-brass-shimmer font-semibold">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total)}
              </span>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-brass/20 text-cream-dim hover:text-cream hover:border-brass/40 bg-transparent"
              >
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || invalidOpenLine || lines.length === 0}
                className="flex-1 bg-brass-shimmer/20 border border-brass/40 text-brass-light hover:bg-brass-shimmer/30 hover:border-brass/60 transition-all"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
