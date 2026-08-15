import OrderStatusChips from "@alts/components/OrderStatusChips";

type Props = {
  current?: string | null;
  onChange?: (status: string) => void;
  disabled?: boolean;
  pending?: string | null;
  /** @deprecated list cards should use OrderStatusChips variant="badge" */
  compact?: boolean;
};

/** Detail-page pipeline. Wraps OrderStatusChips so status writes stay in one place. */
export default function MtmStatusRail({ current, onChange, disabled, pending, compact }: Props) {
  return (
    <OrderStatusChips
      variant={compact ? "badge" : "grid"}
      current={current}
      onChange={onChange}
      disabled={disabled}
      pending={pending}
    />
  );
}
