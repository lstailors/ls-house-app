export interface CartPayload {
  garments: Array<{
    id: string
    ref: string
    garmentType: string
    description: string
    color: string
    notes: string
    lines: Array<{
      preset: string
      description: string
      price: number
      estMinutes: number | null
    }>
    fabric?: string
    condition?: string
    fitAreas?: string[]
    complexity?: string
    photos?: string[]
  }>
  lines: Array<{
    preset: string
    description: string
    price: number
    estMinutes: number | null
  }>
  isRush?: boolean
}

export interface ParkedCart {
  id: string
  createdBy: string
  location: string
  customer: {
    id?: string
    name: string
    phone: string
    email: string
  }
  customerRef: string | null
  /** @deprecated use customer */
  customer_snapshot?: ParkedCart["customer"] | null
  /** @deprecated use customerRef */
  customer_ref?: string | null
  cart: CartPayload
  label?: string
  updated_at: string
}
