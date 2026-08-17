import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Printer,
  Tag,
  Truck,
  User,
  AlertTriangle,
  Copy,
  Check,
  MessageSquare,
  Mail,
  MapPin,
  Pencil,
  Bell,
  Mic,
  CheckCircle2,
  ShoppingCart,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@ls/api-client'
import { cn } from "@ls/design/utils"
import { useMe } from '@ls/auth'
import type { CartPayload } from '@/lib/cart/parked'
import { ChargeTerminalButton } from '@/components/payments/ChargeTerminalButton'
import { ChargeCardOnFileButton } from '@/components/payments/ChargeCardOnFileButton'
import { EditTicketDrawer } from '@/components/alterations/EditTicketDrawer'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@ls/design/ui/dialog"
import { Textarea } from "@ls/design/ui/textarea"
import { Button } from "@ls/design/ui/button"
import { Input } from "@ls/design/ui/input"

// ── Types ──────────────────────────────────────────────────────────────────

interface AlterationTicketDoc {
  name: string
  customer_name: string
  customer: string
  origin_location: string
  workflow_state: string
  ticket_date: string
  due_date: string
  is_rush: 0 | 1
  ticket_total: number
  payment_status: string
  /** Staff-set. Gates SI + payment CTAs. Never auto-derived from price. */
  billing_status?: string
  assigned_tailor?: string
  assigned_tailor_name?: string
  notes?: string
  customer_mobile?: string
  customer_email?: string
  notified_ready_at?: string
  garments?: Array<{
    name: string
    garment_id: string
    garment_type: string
    garment_description: string
    color?: string
  }>
  lines?: Array<{
    name: string
    garment_ref: string
    description: string
    price: number
    preset?: string
  }>
}

interface TailorDoc {
  name: string
  full_name: string
}

interface PaymentLinkResult {
  ok: boolean
  url: string
  payment_link_id: string
}
