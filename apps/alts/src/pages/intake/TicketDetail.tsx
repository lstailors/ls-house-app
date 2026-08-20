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
  Plus,
  Ban,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@ls/api-client'
import { localFirstRow } from '@alts/offline/localFirst'
import { cn } from "@ls/design/utils"
import { useMe } from '@ls/auth'
import type { CartPayload } from '@alts/lib/cart/parked'
import { ChargeTerminalButton } from '@alts/components/payments/ChargeTerminalButton'
import { OutsideTenderButtons } from '@alts/components/payments/OutsideTenderButtons'
import { ChargeCardOnFileButton } from '@alts/components/payments/ChargeCardOnFileButton'
import { EditTicketDrawer } from '@alts/components/alterations/EditTicketDrawer'
import { payUrl } from '@alts/lib/printUrls'
import TicketDeliverySection from '@alts/components/intake/TicketDeliverySection'
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
import { usePepePanelOptional } from "@alts/components/pepe/PepeContext"
