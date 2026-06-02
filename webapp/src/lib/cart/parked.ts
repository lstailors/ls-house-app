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
  }>
  lines: Array<{
    preset: string
    description: string
    price: number
    estMinutes: number | null
  }>
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
  cart: CartPayload
  label?: string
  updated_at: string
}
